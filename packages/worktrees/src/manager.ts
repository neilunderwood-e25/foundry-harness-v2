import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import {
  ChangedFileSchema,
  WorktreeHandleSchema,
  type ChangedFile,
  type WorktreeHandle,
} from "@foundry/contracts";
import type { ComponentJobPlan } from "@foundry/domain";
import { WorktreeError } from "./errors.js";
import { git, gitSucceeds } from "./git.js";

export interface WorktreeManagerOptions {
  readonly projectRoot: string;
  readonly worktreeRoot: string;
}

function safeSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!segment) throw new WorktreeError({ code: "INVALID_PATH_SEGMENT", message: value });
  return segment;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function canonicalFuturePath(path: string): Promise<string> {
  let cursor = resolve(path);
  const missingSegments: string[] = [];
  while (!(await exists(cursor))) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missingSegments.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(await realpath(cursor), ...missingSegments);
}

function assertOutsideRepository(repositoryRoot: string, worktreeRoot: string): void {
  const rel = relative(repositoryRoot, worktreeRoot);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new WorktreeError({
      code: "WORKTREE_ROOT_INSIDE_REPOSITORY",
      message: "The worktree root must be outside the target Git repository",
      details: { repositoryRoot, worktreeRoot },
    });
  }
}

function parsePorcelain(output: string): ChangedFile[] {
  const entries = output.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    files.push(ChangedFileSchema.parse({ status, path }));
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return files;
}

export class GitWorktreeManager {
  readonly #projectRoot: string;
  readonly #worktreeRoot: string;
  #repositoryRoot?: string;
  #projectSubdirectory?: string;

  constructor(options: WorktreeManagerOptions) {
    this.#projectRoot = resolve(options.projectRoot);
    this.#worktreeRoot = resolve(options.worktreeRoot);
  }

  async prepare(job: ComponentJobPlan): Promise<WorktreeHandle> {
    const { repositoryRoot, projectSubdirectory } = await this.#initialize();
    if (
      !(await gitSucceeds(repositoryRoot, [
        "cat-file",
        "-e",
        `${job.specification.baseCommit}^{commit}`,
      ]))
    ) {
      throw new WorktreeError({
        code: "BASE_COMMIT_MISSING",
        message: `Base commit is not available: ${job.specification.baseCommit}`,
      });
    }
    if (
      await gitSucceeds(repositoryRoot, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${job.branch}`,
      ])
    ) {
      throw new WorktreeError({
        code: "WORKTREE_BRANCH_EXISTS",
        message: `Worktree branch already exists: ${job.branch}`,
      });
    }

    const checkoutDir = resolve(
      this.#worktreeRoot,
      safeSegment(job.runId),
      `${String(job.queueIndex + 1).padStart(2, "0")}-${safeSegment(job.slug)}`,
    );
    if (await exists(checkoutDir)) {
      throw new WorktreeError({
        code: "WORKTREE_PATH_EXISTS",
        message: `Worktree path already exists: ${checkoutDir}`,
      });
    }
    await mkdir(resolve(checkoutDir, ".."), { recursive: true });
    await git(
      repositoryRoot,
      ["worktree", "add", "-b", job.branch, checkoutDir, job.specification.baseCommit],
      "WORKTREE_CREATE_FAILED",
    );

    const actualCommit = (await git(checkoutDir, ["rev-parse", "HEAD"])).trim();
    if (actualCommit !== job.specification.baseCommit) {
      throw new WorktreeError({
        code: "WORKTREE_COMMIT_MISMATCH",
        message: `Worktree checked out ${actualCommit}, expected ${job.specification.baseCommit}`,
      });
    }

    return WorktreeHandleSchema.parse({
      jobId: `${job.runId}:${job.componentId}`,
      checkoutDir,
      workingDirectory: resolve(checkoutDir, projectSubdirectory),
      branch: job.branch,
      baseCommit: actualCommit,
    });
  }

  async changedFiles(worktree: WorktreeHandle): Promise<ChangedFile[]> {
    const output = await git(worktree.checkoutDir, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    return parsePorcelain(output);
  }

  async #initialize(): Promise<{ repositoryRoot: string; projectSubdirectory: string }> {
    if (this.#repositoryRoot !== undefined && this.#projectSubdirectory !== undefined) {
      return {
        repositoryRoot: this.#repositoryRoot,
        projectSubdirectory: this.#projectSubdirectory,
      };
    }
    const repositoryRoot = await realpath(
      (
        await git(this.#projectRoot, ["rev-parse", "--show-toplevel"], "NOT_A_GIT_REPOSITORY")
      ).trim(),
    );
    const canonicalProjectRoot = await realpath(this.#projectRoot);
    const canonicalWorktreeRoot = await canonicalFuturePath(this.#worktreeRoot);
    const projectSubdirectory = relative(repositoryRoot, canonicalProjectRoot);
    if (projectSubdirectory.startsWith("..") || isAbsolute(projectSubdirectory)) {
      throw new WorktreeError({
        code: "PROJECT_OUTSIDE_REPOSITORY",
        message: "Project root is outside its resolved Git repository",
      });
    }
    assertOutsideRepository(repositoryRoot, canonicalWorktreeRoot);
    this.#repositoryRoot = repositoryRoot;
    this.#projectSubdirectory = projectSubdirectory;
    return { repositoryRoot, projectSubdirectory };
  }
}
