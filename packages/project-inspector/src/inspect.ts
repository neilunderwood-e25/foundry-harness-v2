import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import {
  ProjectIdSchema,
  ProjectInspectionSchema,
  ShaSchema,
  type InspectionEvidence,
  type PackageManager,
  type ProjectCommand,
  type ProjectInspection,
  type ProjectProfile,
  type ReadinessDiagnostic,
} from "@foundry/contracts";
import { z } from "zod";
import { exists, firstExisting, isDirectory } from "./files.js";

const execFileAsync = promisify(execFile);

const PackageManifestSchema = z.object({
  name: z.string().optional(),
  packageManager: z.string().optional(),
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});

const LOCKFILES: ReadonlyArray<readonly [PackageManager, string]> = [
  ["pnpm", "pnpm-lock.yaml"],
  ["npm", "package-lock.json"],
  ["yarn", "yarn.lock"],
  ["bun", "bun.lock"],
  ["bun", "bun.lockb"],
];

export interface InspectNextProjectOptions {
  rootDir: string;
  projectId?: string;
  commitOverride?: string;
}

function command(executable: string, ...args: string[]): ProjectCommand {
  return { executable, args };
}

function scriptCommand(manager: PackageManager, script: string): ProjectCommand {
  return manager === "npm" ? command("npm", "run", script) : command(manager, "run", script);
}

function installCommand(manager: PackageManager, hasLockfile: boolean): ProjectCommand {
  switch (manager) {
    case "pnpm":
      return command("pnpm", "install", ...(hasLockfile ? ["--frozen-lockfile"] : []));
    case "npm":
      return hasLockfile ? command("npm", "ci") : command("npm", "install");
    case "yarn":
      return command("yarn", "install", ...(hasLockfile ? ["--immutable"] : []));
    case "bun":
      return command("bun", "install", ...(hasLockfile ? ["--frozen-lockfile"] : []));
  }
}

async function resolveCommit(rootDir: string, override?: string): Promise<string | undefined> {
  if (override) return ShaSchema.parse(override);
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rootDir });
    return ShaSchema.parse(stdout.trim());
  } catch {
    return undefined;
  }
}

function pickOptionalScript(
  scripts: Readonly<Record<string, string>>,
  manager: PackageManager,
  candidates: readonly string[],
): ProjectCommand | undefined {
  const name = candidates.find((candidate) => scripts[candidate]);
  return name ? scriptCommand(manager, name) : undefined;
}

function dependencyNames(manifest: z.infer<typeof PackageManifestSchema>): Set<string> {
  return new Set([...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]);
}

function hasDependency(names: Set<string>, pattern: RegExp): boolean {
  return [...names].some((name) => pattern.test(name));
}

export async function inspectNextProject(
  options: InspectNextProjectOptions,
): Promise<ProjectInspection> {
  const rootDir = resolve(options.rootDir);
  const projectId = ProjectIdSchema.parse(options.projectId ?? basename(rootDir));
  const diagnostics: ReadinessDiagnostic[] = [];
  const evidence: InspectionEvidence[] = [];
  const manifestPath = resolve(rootDir, "package.json");

  if (!(await exists(manifestPath))) {
    return ProjectInspectionSchema.parse({
      schemaVersion: 1,
      status: "unsupported",
      rootDir,
      diagnostics: [
        {
          code: "PACKAGE_MANIFEST_MISSING",
          severity: "error",
          message: "package.json was not found",
        },
      ],
      evidence,
    });
  }

  evidence.push({ kind: "manifest", path: "package.json" });

  let manifest: z.infer<typeof PackageManifestSchema>;
  try {
    manifest = PackageManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  } catch (error) {
    return ProjectInspectionSchema.parse({
      schemaVersion: 1,
      status: "unsupported",
      rootDir,
      diagnostics: [
        {
          code: "PACKAGE_MANIFEST_INVALID",
          severity: "error",
          message: error instanceof Error ? error.message : "package.json is invalid",
          path: "package.json",
        },
      ],
      evidence,
    });
  }

  const dependencies = dependencyNames(manifest);
  const nextVersion = manifest.dependencies["next"] ?? manifest.devDependencies["next"];
  if (!nextVersion) {
    diagnostics.push({
      code: "NEXTJS_REQUIRED",
      severity: "error",
      message: "The project must declare Next.js",
      path: "package.json",
    });
  }

  const detectedLocks: Array<{ manager: PackageManager; path: string }> = [];
  for (const [manager, path] of LOCKFILES) {
    if (await exists(resolve(rootDir, path))) detectedLocks.push({ manager, path });
  }
  const distinctManagers = [...new Set(detectedLocks.map(({ manager }) => manager))];
  for (const lock of detectedLocks) evidence.push({ kind: "lockfile", path: lock.path });
  if (distinctManagers.length > 1) {
    diagnostics.push({
      code: "PACKAGE_MANAGER_AMBIGUOUS",
      severity: "error",
      message: `Multiple package-manager lockfiles found: ${detectedLocks.map(({ path }) => path).join(", ")}`,
    });
  }

  const declaredManager = manifest.packageManager?.split("@")[0];
  const packageManager =
    distinctManagers[0] ??
    (declaredManager && ["pnpm", "npm", "yarn", "bun"].includes(declaredManager)
      ? (declaredManager as PackageManager)
      : "npm");
  if (detectedLocks.length === 0) {
    diagnostics.push({
      code: "LOCKFILE_MISSING",
      severity: "warning",
      message: `No lockfile found; inferred ${packageManager}`,
    });
  }

  const routerCandidates = [
    { path: "src/app", router: "app" as const },
    { path: "app", router: "app" as const },
    { path: "src/pages", router: "pages" as const },
    { path: "pages", router: "pages" as const },
  ];
  const routers = [];
  for (const candidate of routerCandidates) {
    if (await isDirectory(resolve(rootDir, candidate.path))) routers.push(candidate);
  }
  const router = routers[0];
  if (!router) {
    diagnostics.push({
      code: "NEXTJS_ROUTER_MISSING",
      severity: "error",
      message: "No app/, src/app/, pages/, or src/pages/ directory was found",
    });
  } else {
    evidence.push({ kind: "router", path: router.path, detail: `${router.router} router` });
    if (routers.length > 1) {
      diagnostics.push({
        code: "MULTIPLE_ROUTERS",
        severity: "warning",
        message: `Multiple router roots found; using ${router.path}`,
      });
    }
  }

  if (!manifest.scripts["build"]) {
    diagnostics.push({
      code: "BUILD_SCRIPT_MISSING",
      severity: "error",
      message: "package.json must define a build script",
      path: "package.json",
    });
  }
  if (!manifest.scripts["dev"]) {
    diagnostics.push({
      code: "DEV_SCRIPT_MISSING",
      severity: "error",
      message: "package.json must define a dev script",
      path: "package.json",
    });
  }

  const commit = await resolveCommit(rootDir, options.commitOverride);
  if (!commit) {
    diagnostics.push({
      code: "GIT_COMMIT_REQUIRED",
      severity: "error",
      message: "The project must be a Git repository with at least one commit",
    });
  }

  const usesSrc = router?.path.startsWith("src/") ?? false;
  const sectionRoot =
    (await firstExisting(
      rootDir,
      [
        "src/components/sections",
        "components/sections",
        "src/components/section",
        "components/section",
      ],
      "directory",
    )) ?? (usesSrc ? "src/components/sections" : "components/sections");
  if (await isDirectory(resolve(rootDir, sectionRoot))) {
    evidence.push({ kind: "section-root", path: sectionRoot });
  } else {
    diagnostics.push({
      code: "SECTION_ROOT_PLANNED",
      severity: "info",
      message: `Section root does not exist yet; Foundry will use ${sectionRoot}`,
      path: sectionRoot,
    });
  }

  const registry = await firstExisting(rootDir, [
    "src/components/sections/registry.tsx",
    "components/sections/registry.tsx",
    "src/lib/components/registry.tsx",
    "lib/components/registry.tsx",
  ]);
  if (registry) evidence.push({ kind: "registry", path: registry });

  const pageQuery = await firstExisting(rootDir, [
    "src/lib/graphql/queries/page.ts",
    "src/lib/graphql/queries/flexiblePage.ts",
    "lib/content/queries/page.ts",
    "lib/graphql/queries/page.ts",
  ]);
  if (pageQuery) evidence.push({ kind: "graphql", path: pageQuery, detail: "page query" });

  const graphqlFragments = await firstExisting(
    rootDir,
    ["src/lib/graphql/fragments", "lib/graphql/fragments", "lib/content/queries/fragments"],
    "directory",
  );
  if (graphqlFragments) {
    evidence.push({ kind: "graphql", path: graphqlFragments, detail: "fragment directory" });
  }

  const contentful = hasDependency(dependencies, /contentful/i);
  const contentstack = hasDependency(dependencies, /contentstack/i);
  if (contentful && contentstack) {
    diagnostics.push({
      code: "CMS_AMBIGUOUS",
      severity: "error",
      message: "Both Contentful and Contentstack dependencies were detected",
      path: "package.json",
    });
  }
  const cms = contentful ? "contentful" : contentstack ? "contentstack" : undefined;
  if (cms) evidence.push({ kind: "cms", path: "package.json", detail: cms });
  else {
    diagnostics.push({
      code: "CMS_NOT_DETECTED",
      severity: "warning",
      message: "No supported CMS dependency was detected; the operator must select one",
    });
  }

  if (diagnostics.some(({ severity }) => severity === "error") || !router || !commit) {
    return ProjectInspectionSchema.parse({
      schemaVersion: 1,
      status: "unsupported",
      rootDir,
      diagnostics,
      evidence,
    });
  }

  const profile: ProjectProfile = {
    schemaVersion: 1,
    projectId,
    rootDir,
    inspectedCommit: commit,
    framework: {
      kind: "nextjs",
      ...(nextVersion ? { version: nextVersion } : {}),
      router: router.router,
      appDir: router.path,
    },
    packageManager,
    commands: {
      install: installCommand(packageManager, detectedLocks.length > 0),
      build: scriptCommand(packageManager, "build"),
      dev: scriptCommand(packageManager, "dev"),
      ...(pickOptionalScript(manifest.scripts, packageManager, ["typecheck", "check-types"])
        ? {
            typecheck: pickOptionalScript(manifest.scripts, packageManager, [
              "typecheck",
              "check-types",
            ]),
          }
        : {}),
      ...(pickOptionalScript(manifest.scripts, packageManager, ["lint"])
        ? { lint: pickOptionalScript(manifest.scripts, packageManager, ["lint"]) }
        : {}),
      ...(pickOptionalScript(manifest.scripts, packageManager, ["test"])
        ? { test: pickOptionalScript(manifest.scripts, packageManager, ["test"]) }
        : {}),
    },
    paths: {
      sectionRoot,
      ...(registry ? { registry } : {}),
      ...(pageQuery ? { pageQuery } : {}),
      ...(graphqlFragments ? { graphqlFragments } : {}),
    },
    ...(cms ? { cms } : {}),
  };

  return ProjectInspectionSchema.parse({
    schemaVersion: 1,
    status: "supported",
    rootDir,
    profile,
    diagnostics,
    evidence,
  });
}
