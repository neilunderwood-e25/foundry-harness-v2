import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { BatchBuildSpecSchema } from "@foundry/contracts";
import { planBatchJobs } from "@foundry/domain";
import { describe, expect, it } from "vitest";
import { GitWorktreeManager } from "../src/index.js";

const execFileAsync = promisify(execFile);
const fingerprint = "b".repeat(64);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

async function createRepository(parent: string): Promise<{ projectRoot: string; sha: string }> {
  const repositoryRoot = resolve(parent, "repository");
  const projectRoot = resolve(repositoryRoot, "apps/site");
  await mkdir(projectRoot, { recursive: true });
  await git(repositoryRoot, "init", "-b", "main");
  await git(repositoryRoot, "config", "user.email", "foundry@example.test");
  await git(repositoryRoot, "config", "user.name", "Foundry Tests");
  await writeFile(resolve(projectRoot, "README.md"), "fixture\n");
  await git(repositoryRoot, "add", ".");
  await git(repositoryRoot, "commit", "-m", "fixture");
  return { projectRoot, sha: await git(repositoryRoot, "rev-parse", "HEAD") };
}

function job(sha: string) {
  const component = {
    schemaVersion: 1,
    runId: "parallel-run",
    componentId: "hero",
    projectId: "fixture",
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
    agent: { provider: "codex" },
  } as const;
  const batch = BatchBuildSpecSchema.parse({
    schemaVersion: 1,
    runId: component.runId,
    projectId: component.projectId,
    baseCommit: sha,
    foundationFingerprint: fingerprint,
    maxParallel: 2,
    components: [component, { ...component, componentId: "cards", slug: "cards" }],
  });
  return planBatchJobs(batch)[0]!;
}

describe("Git worktree manager", () => {
  it("creates a component worktree at the exact base commit and reports changes", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "foundry-worktree-test-"));
    try {
      const { projectRoot, sha } = await createRepository(parent);
      const manager = new GitWorktreeManager({
        projectRoot,
        worktreeRoot: resolve(parent, "worktrees"),
      });
      const handle = await manager.prepare(job(sha));

      expect(await git(handle.checkoutDir, "rev-parse", "HEAD")).toBe(sha);
      expect(handle.workingDirectory).toBe(resolve(handle.checkoutDir, "apps/site"));
      const componentDir = resolve(handle.workingDirectory, "src/components/sections/hero");
      await mkdir(componentDir, { recursive: true });
      await writeFile(resolve(componentDir, "Hero.tsx"), "export function Hero() {}\n");
      expect(await manager.changedFiles(handle)).toEqual([
        { status: "??", path: "apps/site/src/components/sections/hero/Hero.tsx" },
      ]);

      await git(projectRoot, "worktree", "remove", "--force", handle.checkoutDir);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects worktree storage inside the target repository", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "foundry-worktree-safety-"));
    try {
      const { projectRoot, sha } = await createRepository(parent);
      const manager = new GitWorktreeManager({
        projectRoot,
        worktreeRoot: resolve(projectRoot, ".foundry/worktrees"),
      });
      await expect(manager.prepare(job(sha))).rejects.toMatchObject({
        code: "WORKTREE_ROOT_INSIDE_REPOSITORY",
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
