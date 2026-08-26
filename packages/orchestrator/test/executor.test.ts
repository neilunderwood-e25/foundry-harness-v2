import { AgentProviderRegistry, type AgentProvider } from "@foundry/agent-runtime";
import {
  BatchExecutionRequestSchema,
  type BatchExecutionRequest,
  type ChangedFile,
  type RunEvent,
  type WorktreeHandle,
} from "@foundry/contracts";
import type { ComponentJobPlan } from "@foundry/domain";
import { describe, expect, it } from "vitest";
import { BatchExecutor, type WorktreeService } from "../src/index.js";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

function request(componentCount = 3): BatchExecutionRequest {
  const components = Array.from({ length: componentCount }, (_, index) => {
    const slug = ["hero", "cards", "promo"][index] ?? `section-${index + 1}`;
    return {
      schemaVersion: 1,
      runId: "release-42",
      componentId: slug,
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      name: slug,
      slug,
      design: {
        desktopFrameUrl: `https://figma.com/design/file/Foundry?node-id=${index + 1}-2`,
        mobileFrameUrl: `https://figma.com/design/file/Foundry?node-id=${index + 1}-4`,
      },
      cms: {
        provider: "contentful",
        contentType: `${slug}Section`,
        variantField: "frontendComponent",
        variantValue: slug,
      },
      agent: { provider: "codex" },
    };
  });
  return BatchExecutionRequestSchema.parse({
    schemaVersion: 1,
    project: {
      schemaVersion: 1,
      projectId: "project-1",
      rootDir: "/tmp/project",
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
        paddingByBreakpoint: {
          base: { top: 0, right: 16, bottom: 0, left: 16 },
        },
        supportsFullBleed: true,
        supportedProps: ["children"],
      },
    },
    batch: {
      schemaVersion: 1,
      runId: "release-42",
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components,
    },
    worktreeRoot: "/tmp/foundry-worktrees",
  });
}

class FakeWorktrees implements WorktreeService {
  readonly #jobs = new Map<string, ComponentJobPlan>();
  readonly #outsideScope: boolean;

  constructor(outsideScope = false) {
    this.#outsideScope = outsideScope;
  }

  async prepare(job: ComponentJobPlan): Promise<WorktreeHandle> {
    const checkoutDir = `/tmp/worktrees/${job.slug}`;
    this.#jobs.set(checkoutDir, job);
    return {
      jobId: `${job.runId}:${job.componentId}` as WorktreeHandle["jobId"],
      checkoutDir,
      workingDirectory: checkoutDir,
      branch: job.branch,
      baseCommit: job.specification.baseCommit,
    };
  }

  async changedFiles(worktree: WorktreeHandle): Promise<ChangedFile[]> {
    const job = this.#jobs.get(worktree.checkoutDir);
    if (!job) throw new Error("Unknown worktree");
    return [
      this.#outsideScope
        ? { status: "M", path: "package.json" }
        : {
            status: "??",
            path: `src/components/sections/${job.slug}/Section.tsx`,
          },
    ];
  }
}

function concurrencyProvider(metrics: { active: number; maximum: number }): AgentProvider {
  return {
    name: "codex",
    capabilities: { streaming: true, sessions: true, toolEvents: true, cancellation: true },
    async execute(input, emit) {
      metrics.active += 1;
      metrics.maximum = Math.max(metrics.maximum, metrics.active);
      await emit({ type: "text", text: `Building ${input.specification.slug}` });
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
      metrics.active -= 1;
      return { status: "completed", sessionId: `session-${input.specification.slug}` };
    },
  };
}

describe("batch executor", () => {
  it("runs component jobs concurrently with ordered events and isolated worktrees", async () => {
    const metrics = { active: 0, maximum: 0 };
    const events: RunEvent[] = [];
    const executor = new BatchExecutor({
      providers: new AgentProviderRegistry([concurrencyProvider(metrics)]),
      worktreeManagerFactory: () => new FakeWorktrees(),
    });

    const result = await executor.execute(request(), {
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(result.status).toBe("completed");
    expect(result.jobs.map(({ status }) => status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(metrics.maximum).toBe(2);
    expect(events.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index),
    );
    expect(events[0]?.payload.type).toBe("run.started");
    expect(events.at(-1)?.payload).toEqual({ type: "run.completed", status: "completed" });
  });

  it("fails jobs that modify files outside their component directory", async () => {
    const metrics = { active: 0, maximum: 0 };
    const executor = new BatchExecutor({
      providers: new AgentProviderRegistry([concurrencyProvider(metrics)]),
      worktreeManagerFactory: () => new FakeWorktrees(true),
    });

    const result = await executor.execute(request(2));
    expect(result.status).toBe("failed");
    expect(result.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "failed", code: "OUT_OF_SCOPE_CHANGES" }),
      ]),
    );
  });

  it("cancels queued jobs without invoking a provider", async () => {
    const metrics = { active: 0, maximum: 0 };
    const events: RunEvent[] = [];
    const controller = new AbortController();
    controller.abort("operator cancelled");
    const executor = new BatchExecutor({
      providers: new AgentProviderRegistry([concurrencyProvider(metrics)]),
      worktreeManagerFactory: () => new FakeWorktrees(),
    });

    const result = await executor.execute(request(2), {
      signal: controller.signal,
      onEvent(event) {
        events.push(event);
      },
    });

    expect(result.status).toBe("cancelled");
    expect(result.jobs.every(({ status }) => status === "cancelled")).toBe(true);
    expect(metrics.maximum).toBe(0);
    expect(events.at(-1)?.payload.type).toBe("run.cancelled");
  });
});
