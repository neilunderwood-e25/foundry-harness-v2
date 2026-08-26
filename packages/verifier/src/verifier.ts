import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  SectionManifestSchema,
  VerificationReportSchema,
  type BatchDeliveryRequest,
  type ChangedFile,
  type ComponentBuildSpec,
  type ProjectCommand,
  type SectionManifest,
  type VerificationGate,
  type VerificationPolicy,
  type VerificationReport,
  type WorktreeHandle,
} from "@foundry/contracts";
import { ProcessCommandRunner, type CommandRunner } from "./commands.js";

export interface ComponentVerificationInput {
  readonly request: BatchDeliveryRequest;
  readonly specification: ComponentBuildSpec;
  readonly worktree: WorktreeHandle;
  readonly changedFiles: readonly ChangedFile[];
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

export interface QualityGateVerifier {
  verify(input: {
    request: BatchDeliveryRequest;
    specification: ComponentBuildSpec;
    worktree: WorktreeHandle;
    attempt: number;
    signal?: AbortSignal;
  }): Promise<VerificationGate[]>;
}

export interface ComponentVerifierOptions {
  readonly commandRunner?: CommandRunner;
  readonly qualityVerifier?: QualityGateVerifier;
  readonly clock?: () => Date;
}

function normalized(path: string): string {
  return path.split(sep).join("/");
}

export function toProjectPath(worktree: WorktreeHandle, path: string): string {
  const subdirectory = normalized(relative(worktree.checkoutDir, worktree.workingDirectory));
  const candidate = normalized(path);
  if (!subdirectory) return candidate;
  const prefix = `${subdirectory}/`;
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length) : `../${candidate}`;
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

async function fileExists(root: string, path: string): Promise<boolean> {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
}

async function fingerprintFoundation(input: ComponentVerificationInput): Promise<string> {
  const hash = createHash("sha256");
  const paths = [
    ...new Set([
      ...input.request.foundation.styleGuide.files,
      input.request.foundation.container.componentPath,
    ]),
  ].sort();
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(resolve(input.worktree.workingDirectory, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function gate(
  id: string,
  label: string,
  category: VerificationGate["category"],
  status: VerificationGate["status"],
  detail?: string,
): VerificationGate {
  return { id, label, category, status, artifacts: [], ...(detail ? { detail } : {}) };
}

function manifestSemantics(
  manifest: SectionManifest,
  input: ComponentVerificationInput,
  componentRoot: string,
  manifestPath: string,
): string[] {
  const errors: string[] = [];
  const expected = input.specification;
  if (manifest.componentId !== expected.componentId)
    errors.push("componentId does not match the job");
  if (manifest.cmsType !== expected.cms.contentType)
    errors.push("cmsType does not match the mapped CMS type");
  if (manifest.variant !== expected.cms.variantValue)
    errors.push("variant does not match the mapped CMS variant");

  const requiredOwned = [
    manifestPath,
    manifest.componentPath,
    manifest.fragmentPath,
    manifest.transformPath,
  ];
  for (const path of requiredOwned) {
    if (!inside(componentRoot, path)) errors.push(`${path} is outside ${componentRoot}`);
    if (!manifest.ownedFiles.includes(path)) errors.push(`${path} is missing from ownedFiles`);
  }
  if (manifest.bindings.length === 0) errors.push("bindings must describe at least one CMS field");
  return errors;
}

async function inspectManifest(
  input: ComponentVerificationInput,
  componentRoot: string,
  manifestPath: string,
): Promise<{ manifest?: SectionManifest; detail?: string }> {
  try {
    const manifest = SectionManifestSchema.parse(
      JSON.parse(await readFile(resolve(input.worktree.workingDirectory, manifestPath), "utf8")),
    );
    const errors = manifestSemantics(manifest, input, componentRoot, manifestPath);
    const missing: string[] = [];
    for (const path of manifest.ownedFiles) {
      if (!(await fileExists(input.worktree.workingDirectory, path))) missing.push(path);
    }
    if (missing.length > 0) errors.push(`owned files do not exist: ${missing.join(", ")}`);

    const changed = input.changedFiles.map(({ path }) => toProjectPath(input.worktree, path));
    const undeclared = changed.filter((path) => !manifest.ownedFiles.includes(path));
    if (undeclared.length > 0)
      errors.push(`changed files missing from ownedFiles: ${undeclared.join(", ")}`);
    return errors.length > 0 ? { detail: errors.join("; ") } : { manifest };
  } catch (error) {
    return { detail: error instanceof Error ? error.message : String(error) };
  }
}

interface CommandGateSpec {
  readonly id: string;
  readonly label: string;
  readonly command: ProjectCommand | undefined;
  readonly enabled: boolean;
  readonly category: VerificationGate["category"];
}

export async function verifyProjectCommands(
  cwd: string,
  commands: BatchDeliveryRequest["project"]["commands"],
  policy: VerificationPolicy,
  runner: CommandRunner,
): Promise<VerificationGate[]> {
  const gates: VerificationGate[] = [];
  if (policy.installDependencies) {
    const result = await runner.run(cwd, commands.install, policy.commandTimeoutMs);
    gates.push(
      gate(
        "dependencies",
        "Install dependencies",
        "runtime",
        result.ok ? "passed" : "failed",
        result.detail,
      ),
    );
    if (!result.ok) return gates;
  } else {
    gates.push(
      gate(
        "dependencies",
        "Install dependencies",
        "runtime",
        "skipped",
        "Disabled by verification policy",
      ),
    );
  }

  const specifications: CommandGateSpec[] = [
    {
      id: "typecheck",
      label: "TypeScript",
      command: commands.typecheck,
      enabled: policy.runTypecheck,
      category: "code",
    },
    {
      id: "lint",
      label: "Lint",
      command: commands.lint,
      enabled: policy.runLint,
      category: "code",
    },
    {
      id: "test",
      label: "Tests",
      command: commands.test,
      enabled: policy.runTests,
      category: "runtime",
    },
    {
      id: "build",
      label: "Production build",
      command: commands.build,
      enabled: policy.runBuild,
      category: "runtime",
    },
  ];
  for (const specification of specifications) {
    if (!specification.enabled) {
      gates.push(
        gate(
          specification.id,
          specification.label,
          specification.category,
          "skipped",
          "Disabled by verification policy",
        ),
      );
      continue;
    }
    if (!specification.command) {
      gates.push(
        gate(
          specification.id,
          specification.label,
          specification.category,
          "skipped",
          "Project command is not configured",
        ),
      );
      continue;
    }
    const result = await runner.run(cwd, specification.command, policy.commandTimeoutMs);
    gates.push(
      gate(
        specification.id,
        specification.label,
        specification.category,
        result.ok ? "passed" : "failed",
        result.detail,
      ),
    );
  }
  return gates;
}

export class ComponentVerifier {
  readonly #runner: CommandRunner;
  readonly #qualityVerifier: QualityGateVerifier | undefined;
  readonly #clock: () => Date;

  constructor(options: ComponentVerifierOptions = {}) {
    this.#runner = options.commandRunner ?? new ProcessCommandRunner();
    this.#qualityVerifier = options.qualityVerifier;
    this.#clock = options.clock ?? (() => new Date());
  }

  async verify(input: ComponentVerificationInput): Promise<VerificationReport> {
    const startedAt = this.#clock().toISOString();
    const componentRoot = `${input.request.project.paths.sectionRoot}/${input.specification.slug}`;
    const manifestPath = `${componentRoot}/section.manifest.json`;
    const changed = input.changedFiles.map(({ path }) => toProjectPath(input.worktree, path));
    const outside = changed.filter((path) => !inside(componentRoot, path));
    const gates: VerificationGate[] = [
      gate(
        "scope",
        "Component ownership",
        "scope",
        changed.length > 0 && outside.length === 0 ? "passed" : "failed",
        changed.length === 0
          ? "The agent did not change any files"
          : outside.length > 0
            ? `Files outside component scope: ${outside.join(", ")}`
            : undefined,
      ),
    ];

    const manifest = await inspectManifest(input, componentRoot, manifestPath);
    gates.push(
      gate(
        "manifest",
        "Section manifest",
        "data",
        manifest.manifest ? "passed" : "failed",
        manifest.detail,
      ),
    );

    try {
      const fingerprint = await fingerprintFoundation(input);
      gates.push(
        gate(
          "foundation",
          "Frozen Style Guide and Container",
          "foundation",
          fingerprint === input.request.foundation.fingerprint ? "passed" : "failed",
          fingerprint === input.request.foundation.fingerprint
            ? undefined
            : "Style Guide or Container differs from the frozen foundation",
        ),
      );
    } catch (error) {
      gates.push(
        gate(
          "foundation",
          "Frozen Style Guide and Container",
          "foundation",
          "failed",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }

    if (gates.every(({ status }) => status !== "failed")) {
      gates.push(
        ...(await verifyProjectCommands(
          input.worktree.workingDirectory,
          input.request.project.commands,
          input.request.verification,
          this.#runner,
        )),
      );
    }

    if (this.#qualityVerifier) {
      if (gates.every(({ status }) => status !== "failed")) {
        gates.push(
          ...(await this.#qualityVerifier.verify({
            request: input.request,
            specification: input.specification,
            worktree: input.worktree,
            attempt: input.attempt,
            ...(input.signal ? { signal: input.signal } : {}),
          })),
        );
      } else if (input.request.quality.enabled) {
        gates.push(
          gate(
            "quality",
            "Visual and accessibility QA",
            "visual",
            "skipped",
            "Code or runtime gates failed first",
          ),
        );
      }
    }

    return VerificationReportSchema.parse({
      schemaVersion: 1,
      runId: input.request.batch.runId,
      componentId: input.specification.componentId,
      verdict: gates.some(({ status }) => status === "failed") ? "failed" : "passed",
      attempt: input.attempt,
      startedAt,
      completedAt: this.#clock().toISOString(),
      gates,
    });
  }
}
