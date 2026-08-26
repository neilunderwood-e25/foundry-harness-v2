import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  BatchDeliveryRequestSchema,
  type BatchDeliveryRequest,
  type ChangedFile,
  type WorktreeHandle,
} from "@foundry/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ComponentVerifier, type CommandRunner } from "../src/index.js";

const roots: string[] = [];
const sha = "a".repeat(40);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class PassingCommands implements CommandRunner {
  calls = 0;

  async run() {
    this.calls += 1;
    return { ok: true, detail: "passed" };
  }
}

async function fixture(): Promise<{
  request: BatchDeliveryRequest;
  worktree: WorktreeHandle;
  changedFiles: ChangedFile[];
}> {
  const root = await mkdtemp(resolve(tmpdir(), "foundry-verifier-"));
  roots.push(root);
  const files: Record<string, string> = {
    "src/styles/tokens.css": ":root { --color-primary: #123456; }\n",
    "src/components/ui/Container.tsx": "export function Container() {}\n",
    "src/components/sections/hero/Section.tsx": "export default function Hero() { return null; }\n",
    "src/components/sections/hero/fragment.graphql": "fragment HeroFields on Hero { title }\n",
    "src/components/sections/hero/transform.ts":
      "export const transform = (value: unknown) => value;\n",
  };
  const manifest = {
    schemaVersion: 1,
    componentId: "hero",
    componentPath: "src/components/sections/hero/Section.tsx",
    cmsType: "HeroSection",
    variant: "Hero",
    fragmentPath: "src/components/sections/hero/fragment.graphql",
    fragmentName: "HeroFields",
    transformPath: "src/components/sections/hero/transform.ts",
    registryKey: "Hero",
    bindings: [
      {
        cmsField: "title",
        graphqlPath: "title",
        propPath: "title",
        cardinality: "one",
        required: true,
      },
    ],
    ownedFiles: [
      "src/components/sections/hero/Section.tsx",
      "src/components/sections/hero/fragment.graphql",
      "src/components/sections/hero/transform.ts",
      "src/components/sections/hero/section.manifest.json",
    ],
  };
  files["src/components/sections/hero/section.manifest.json"] = JSON.stringify(manifest);
  for (const [path, source] of Object.entries(files)) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), source);
  }

  const hash = createHash("sha256");
  for (const path of ["src/components/ui/Container.tsx", "src/styles/tokens.css"].sort()) {
    hash.update(path);
    hash.update("\0");
    hash.update(files[path]!);
    hash.update("\0");
  }
  const fingerprint = hash.digest("hex");
  const component = {
    schemaVersion: 1,
    runId: "delivery-run",
    componentId: "hero",
    projectId: "project-1",
    baseCommit: sha,
    foundationFingerprint: fingerprint,
    name: "Hero",
    slug: "hero",
    design: {
      desktopFrameUrl: "https://figma.com/design/file/Foundry?node-id=1-2",
      mobileFrameUrl: "https://figma.com/design/file/Foundry?node-id=3-4",
    },
    cms: {
      provider: "contentful",
      contentType: "HeroSection",
      variantField: "frontendComponent",
      variantValue: "Hero",
    },
    agent: { provider: "codex", maxRepairTurns: 1 },
  } as const;
  const request = BatchDeliveryRequestSchema.parse({
    schemaVersion: 1,
    project: {
      schemaVersion: 1,
      projectId: "project-1",
      rootDir: root,
      inspectedCommit: sha,
      framework: { kind: "nextjs", router: "app", appDir: "src/app" },
      packageManager: "pnpm",
      commands: {
        install: { executable: "pnpm", args: ["install"] },
        build: { executable: "pnpm", args: ["build"] },
        dev: { executable: "pnpm", args: ["dev"] },
      },
      paths: { sectionRoot: "src/components/sections" },
    },
    foundation: {
      schemaVersion: 1,
      projectId: "project-1",
      status: "ready",
      sourceCommit: sha,
      fingerprint,
      reasons: [],
      styleGuide: {
        source: "existing",
        files: ["src/styles/tokens.css"],
        colors: [],
        spacing: [],
        typography: [],
        breakpoints: { md: 768 },
        primitives: [],
      },
      container: {
        source: "existing",
        componentPath: "src/components/ui/Container.tsx",
        importPath: "@/components/ui/Container",
        desktopMaxWidth: 1440,
        mobileMaxWidth: "fluid",
        paddingByBreakpoint: { base: { top: 0, right: 16, bottom: 0, left: 16 } },
        supportsFullBleed: true,
        supportedProps: ["children"],
      },
    },
    batch: {
      schemaVersion: 1,
      runId: "delivery-run",
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: [component, { ...component, componentId: "cards", slug: "cards" }],
    },
    worktreeRoot: resolve(root, "..", "worktrees"),
    verification: {
      installDependencies: true,
      runBuild: true,
      runTypecheck: true,
      runLint: true,
      runTests: false,
      commandTimeoutMs: 10_000,
    },
  });
  const changedFiles = manifest.ownedFiles.map((path) => ({ status: "??", path }));
  return {
    request,
    worktree: {
      jobId: "delivery-run:hero" as WorktreeHandle["jobId"],
      checkoutDir: root,
      workingDirectory: root,
      branch: "foundry/delivery-run/hero",
      baseCommit: sha,
    },
    changedFiles,
  };
}

describe("component verifier", () => {
  it("passes a scoped manifest, frozen foundation, and configured project commands", async () => {
    const input = await fixture();
    const commands = new PassingCommands();
    const report = await new ComponentVerifier({ commandRunner: commands }).verify({
      ...input,
      specification: input.request.batch.components[0]!,
      attempt: 1,
    });

    expect(report.verdict).toBe("passed");
    expect(commands.calls).toBe(2);
    expect(report.gates.map(({ id }) => id)).toEqual([
      "scope",
      "manifest",
      "foundation",
      "dependencies",
      "typecheck",
      "lint",
      "test",
      "build",
    ]);
  });

  it("fails before commands when an agent changes a shared project file", async () => {
    const input = await fixture();
    const commands = new PassingCommands();
    const report = await new ComponentVerifier({ commandRunner: commands }).verify({
      ...input,
      changedFiles: [...input.changedFiles, { status: "M", path: "package.json" }],
      specification: input.request.batch.components[0]!,
      attempt: 1,
    });

    expect(report.verdict).toBe("failed");
    expect(report.gates.find(({ id }) => id === "scope")?.status).toBe("failed");
    expect(commands.calls).toBe(0);
  });
});
