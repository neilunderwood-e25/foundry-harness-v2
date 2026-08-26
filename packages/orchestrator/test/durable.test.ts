import {
  BatchDeliveryRequestSchema,
  BatchDeliveryResultSchema,
  RunEventSchema,
  type BatchDeliveryRequest,
  type RunEventPayload,
} from "@foundry/contracts";
import { SqliteRunStore } from "@foundry/persistence";
import { describe, expect, it } from "vitest";
import {
  DurableRunCoordinator,
  type DurableDeliveryRunner,
  type RunEventSink,
} from "../src/index.js";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

function request(): BatchDeliveryRequest {
  const component = (slug: string) => ({
    schemaVersion: 1 as const,
    runId: "durable-1",
    componentId: slug,
    projectId: "project-1",
    baseCommit: sha,
    foundationFingerprint: fingerprint,
    name: slug,
    slug,
    design: {
      desktopFrameUrl: `https://figma.com/design/file/Foundry?node-id=${slug}-1`,
      mobileFrameUrl: `https://figma.com/design/file/Foundry?node-id=${slug}-2`,
    },
    cms: {
      provider: "contentful" as const,
      contentType: `${slug}Section`,
      variantField: "frontendComponent",
      variantValue: slug,
    },
    agent: { provider: "codex" as const },
  });
  return BatchDeliveryRequestSchema.parse({
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
      runId: "durable-1",
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: [component("hero"), component("cards")],
    },
    worktreeRoot: "/tmp/worktrees",
  });
}

function runEvent(sequence: number, payload: RunEventPayload) {
  return RunEventSchema.parse({
    schemaVersion: 1,
    eventId: `durable-1:${sequence}`,
    runId: "durable-1",
    sequence,
    occurredAt: new Date().toISOString(),
    payload,
  });
}

class CompletedRunner implements DurableDeliveryRunner {
  async deliver(input: BatchDeliveryRequest, options: { onEvent: RunEventSink }) {
    await options.onEvent(runEvent(0, { type: "run.started" }));
    await options.onEvent(runEvent(1, { type: "run.completed", status: "passed" }));
    return BatchDeliveryResultSchema.parse({
      schemaVersion: 1,
      runId: input.batch.runId,
      status: "passed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      jobs: [],
    });
  }
}

class CancelledRunner implements DurableDeliveryRunner {
  async deliver(
    input: BatchDeliveryRequest,
    options: { onEvent: RunEventSink; signal: AbortSignal },
  ) {
    await options.onEvent(runEvent(0, { type: "run.started" }));
    await new Promise<void>((resolve) => {
      if (options.signal.aborted) resolve();
      else options.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    await options.onEvent(runEvent(1, { type: "run.cancelled", reason: "Delivery was cancelled" }));
    return BatchDeliveryResultSchema.parse({
      schemaVersion: 1,
      runId: input.batch.runId,
      status: "cancelled",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      jobs: [],
    });
  }
}

describe("durable run coordinator", () => {
  it("runs in the background and replays persisted events to late subscribers", async () => {
    const coordinator = new DurableRunCoordinator({
      repository: new SqliteRunStore({ databasePath: ":memory:" }),
      deliveryRunnerFactory: () => new CompletedRunner(),
    });
    expect(coordinator.startDelivery(request()).status).toBe("queued");
    expect((await coordinator.waitForRun("durable-1")).status).toBe("passed");
    const replayed: number[] = [];
    const unsubscribe = coordinator.subscribe("durable-1", -1, ({ sequence }) =>
      replayed.push(sequence),
    );
    expect(replayed).toEqual([0, 1]);
    unsubscribe();
    await coordinator.close();
  });

  it("propagates cancellation through the run AbortSignal", async () => {
    const coordinator = new DurableRunCoordinator({
      repository: new SqliteRunStore({ databasePath: ":memory:" }),
      deliveryRunnerFactory: () => new CancelledRunner(),
    });
    coordinator.startDelivery(request());
    await Promise.resolve();
    expect(coordinator.cancel("durable-1")).toMatchObject({
      accepted: true,
      status: "cancelling",
    });
    expect((await coordinator.waitForRun("durable-1")).status).toBe("cancelled");
    await coordinator.close();
  });
});
