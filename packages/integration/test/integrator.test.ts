import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  BatchDeliveryRequestSchema,
  type BatchDeliveryRequest,
  type DeliveredComponent,
  type WorktreeHandle,
} from "@foundry/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { GitBatchIntegrator } from "../src/index.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const fingerprint = "b".repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

async function writeComponent(
  projectRoot: string,
  slug: string,
  registryKey: string,
): Promise<void> {
  const root = resolve(projectRoot, "src/components/sections", slug);
  await mkdir(root, { recursive: true });
  const ownedFiles = [
    `src/components/sections/${slug}/Section.tsx`,
    `src/components/sections/${slug}/fragment.graphql`,
    `src/components/sections/${slug}/transform.ts`,
    `src/components/sections/${slug}/section.manifest.json`,
  ];
  await writeFile(
    resolve(root, "Section.tsx"),
    `export default function ${registryKey}() { return null; }\n`,
  );
  await writeFile(
    resolve(root, "fragment.graphql"),
    `fragment ${registryKey}Fields on ${registryKey}Section { title }\n`,
  );
  await writeFile(
    resolve(root, "transform.ts"),
    "export const transform = (value: unknown) => value;\n",
  );
  await writeFile(
    resolve(root, "section.manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      componentId: slug,
      componentPath: ownedFiles[0],
      cmsType: `${registryKey}Section`,
      variant: registryKey,
      fragmentPath: ownedFiles[1],
      fragmentName: `${registryKey}Fields`,
      transformPath: ownedFiles[2],
      registryKey,
      bindings: [
        {
          cmsField: "title",
          graphqlPath: "title",
          propPath: "title",
          cardinality: "one",
          required: true,
        },
      ],
      ownedFiles,
    }),
  );
}

function componentSpec(baseCommit: string, slug: string, name: string) {
  return {
    schemaVersion: 1,
    runId: "release-1",
    componentId: slug,
    projectId: "site",
    baseCommit,
    foundationFingerprint: fingerprint,
    name,
    slug,
    design: {
      desktopFrameUrl: `https://figma.com/design/file/Foundry?node-id=${slug}-1`,
      mobileFrameUrl: `https://figma.com/design/file/Foundry?node-id=${slug}-2`,
    },
    cms: {
      provider: "contentful",
      contentType: `${name}Section`,
      variantField: "frontendComponent",
      variantValue: name,
    },
    agent: { provider: "codex", maxRepairTurns: 1 },
  } as const;
}

async function fixture(): Promise<{
  repositoryRoot: string;
  request: BatchDeliveryRequest;
  components: DeliveredComponent[];
}> {
  const parent = await mkdtemp(resolve(tmpdir(), "foundry-integration-"));
  roots.push(parent);
  const repositoryRoot = resolve(parent, "repository");
  const projectRoot = resolve(repositoryRoot, "apps/site");
  await mkdir(resolve(projectRoot, "src/components/sections"), { recursive: true });
  await git(repositoryRoot, "init", "-b", "main");
  await git(repositoryRoot, "config", "user.email", "foundry@example.test");
  await git(repositoryRoot, "config", "user.name", "Foundry Tests");
  await writeFile(resolve(projectRoot, "README.md"), "site\n");
  await git(repositoryRoot, "add", ".");
  await git(repositoryRoot, "commit", "-m", "base");
  const baseCommit = await git(repositoryRoot, "rev-parse", "HEAD");

  const delivered: DeliveredComponent[] = [];
  for (const [slug, name] of [
    ["hero", "Hero"],
    ["cards", "Cards"],
  ] as const) {
    await git(repositoryRoot, "switch", "-c", `foundry/release-1/${slug}`, baseCommit);
    await writeComponent(projectRoot, slug, name);
    await git(repositoryRoot, "add", ".");
    await git(repositoryRoot, "commit", "-m", `add ${slug}`);
    const commit = await git(repositoryRoot, "rev-parse", "HEAD");
    const checkout = {
      jobId: `release-1:${slug}` as WorktreeHandle["jobId"],
      checkoutDir: repositoryRoot,
      workingDirectory: projectRoot,
      branch: `foundry/release-1/${slug}`,
      baseCommit,
    };
    delivered.push({
      status: "passed",
      jobId: checkout.jobId,
      componentId: slug as DeliveredComponent["componentId"],
      worktree: checkout,
      changedFiles: [
        {
          status: "A ",
          path: `apps/site/src/components/sections/${slug}/section.manifest.json`,
        },
      ],
      reports: [
        {
          schemaVersion: 1,
          runId: "release-1" as DeliveredComponent["reports"][number]["runId"],
          componentId: slug as DeliveredComponent["componentId"],
          verdict: "passed",
          attempt: 1,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          gates: [
            {
              id: "fixture",
              label: "Fixture",
              category: "code",
              status: "passed",
              artifacts: [],
            },
          ],
        },
      ],
      commit,
    });
  }
  await git(repositoryRoot, "switch", "main");

  const specs = [
    componentSpec(baseCommit, "hero", "Hero"),
    componentSpec(baseCommit, "cards", "Cards"),
  ];
  const request = BatchDeliveryRequestSchema.parse({
    schemaVersion: 1,
    project: {
      schemaVersion: 1,
      projectId: "site",
      rootDir: projectRoot,
      inspectedCommit: baseCommit,
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
      projectId: "site",
      status: "ready",
      sourceCommit: baseCommit,
      fingerprint,
      reasons: [],
      styleGuide: {
        source: "existing",
        files: ["src/styles/tokens.css"],
        colors: [],
        spacing: [],
        typography: [],
        breakpoints: {},
        primitives: [],
      },
      container: {
        source: "existing",
        componentPath: "src/components/ui/Container.tsx",
        importPath: "@/components/ui/Container",
        desktopMaxWidth: "fluid",
        mobileMaxWidth: "fluid",
        paddingByBreakpoint: {},
        supportsFullBleed: false,
        supportedProps: ["children"],
      },
    },
    batch: {
      schemaVersion: 1,
      runId: "release-1",
      projectId: "site",
      baseCommit,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: specs,
    },
    worktreeRoot: resolve(parent, "worktrees"),
    verification: {
      installDependencies: false,
      runBuild: false,
      runTypecheck: false,
      runLint: false,
      runTests: false,
      commandTimeoutMs: 10_000,
    },
  });
  return { repositoryRoot, request, components: delivered };
}

describe("Git batch integrator", () => {
  it("serially integrates component commits and generates deterministic shared wiring", async () => {
    const { repositoryRoot, request, components } = await fixture();
    const originalHead = await git(repositoryRoot, "rev-parse", "HEAD");
    const result = await new GitBatchIntegrator().integrate(request, components);

    expect(result.status).toBe("passed");
    expect(result.branch).toBe("foundry/release-1/integration");
    expect(result.componentCommits).toEqual(components.map(({ commit }) => commit));
    expect(await git(repositoryRoot, "rev-parse", "HEAD")).toBe(originalHead);
    const registry = await readFile(
      resolve(
        result.checkoutDir,
        "apps/site/src/components/sections/foundry.registry.generated.ts",
      ),
      "utf8",
    );
    expect(registry).toContain('"Cards"');
    expect(registry).toContain('"Hero"');
    expect(registry.indexOf('"Cards"')).toBeLessThan(registry.indexOf('"Hero"'));
    expect(
      await readFile(
        resolve(
          result.checkoutDir,
          "apps/site/src/components/sections/foundry.fragments.generated.ts",
        ),
        "utf8",
      ),
    ).toContain("HeroFields");
  });
});
