import {
  BatchDeliveryRequestSchema,
  BatchDeliveryResultSchema,
  RunEventSchema,
  VerificationReportSchema,
  type BatchDeliveryRequest,
} from "@foundry/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceError, SqliteRunStore } from "../src/index.js";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const temporaryDirectories: string[] = [];

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "foundry-persistence-"));
  temporaryDirectories.push(directory);
  return join(directory, "foundry.sqlite");
}

function request(): BatchDeliveryRequest {
  const component = (slug: string) => ({
    schemaVersion: 1 as const,
    runId: "persisted-run",
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
    agent: { provider: "codex" as const, maxRepairTurns: 1 },
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
      runId: "persisted-run",
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: [component("hero"), component("cards")],
    },
    worktreeRoot: "/tmp/worktrees",
  });
}

function event(sequence: number, payload: unknown) {
  return RunEventSchema.parse({
    schemaVersion: 1,
    eventId: `persisted-run:${sequence}`,
    runId: "persisted-run",
    sequence,
    occurredAt: new Date(1_700_000_000_000 + sequence).toISOString(),
    payload,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("SQLite run store", () => {
  it("persists registered project readiness independently of runs", async () => {
    let time = 1_700_000_000_000;
    const store = new SqliteRunStore({
      databasePath: await databasePath(),
      clock: () => new Date(time++),
    });
    const delivery = request();
    const registered = store.saveProject(delivery.project, {
      schemaVersion: 1,
      projectId: delivery.project.projectId,
      status: "missing",
      reasons: ["Container component was not found"],
    });

    expect(registered.foundation.status).toBe("missing");
    expect(store.listProjects()).toHaveLength(1);

    const refreshed = store.saveProject(delivery.project, delivery.foundation);
    expect(refreshed.foundation.status).toBe("ready");
    expect(refreshed.createdAt).toBe(registered.createdAt);
    expect(refreshed.updatedAt).not.toBe(registered.updatedAt);
    expect(store.requireProject("project-1").profile.framework.kind).toBe("nextjs");
    expect(() => store.requireProject("unknown-project")).toThrowError(PersistenceError);
    store.close();
  });

  it("persists ordered events and run state across process restarts", async () => {
    const path = await databasePath();
    const first = new SqliteRunStore({ databasePath: path });
    first.createDeliveryRun(request());
    first.appendEvent(event(0, { type: "run.started" }));
    const queued = event(1, {
      type: "job.queued",
      jobId: "persisted-run:hero",
      componentId: "hero",
    });
    first.appendEvent(queued);
    first.appendEvent(queued);
    expect(() => first.appendEvent(event(1, { type: "run.started" }))).toThrowError(
      PersistenceError,
    );
    expect(() => first.appendEvent(event(3, { type: "run.started" }))).toThrowError(
      PersistenceError,
    );
    first.close();

    const reopened = new SqliteRunStore({ databasePath: path });
    expect(reopened.requireRun("persisted-run").status).toBe("running");
    expect(reopened.listEvents("persisted-run").map(({ sequence }) => sequence)).toEqual([0, 1]);
    expect(reopened.getSnapshot("persisted-run")?.jobs).toMatchObject([
      { jobId: "persisted-run:hero", status: "queued" },
    ]);
    reopened.close();
  });

  it("redacts agent output before writing durable events", async () => {
    const store = new SqliteRunStore({ databasePath: await databasePath() });
    store.createDeliveryRun(request());
    store.appendEvent(event(0, { type: "run.started" }));
    store.appendEvent(
      event(1, {
        type: "agent.text",
        jobId: "persisted-run:hero",
        text: "Authorization: Bearer abcdefghijkl",
      }),
    );
    expect(store.listEvents("persisted-run")[1]?.payload).toMatchObject({
      type: "agent.text",
      text: "Authorization: [REDACTED]",
    });
    store.close();
  });

  it("marks active runs and workflow steps interrupted during recovery", async () => {
    const path = await databasePath();
    const first = new SqliteRunStore({ databasePath: path });
    first.createDeliveryRun(request());
    first.appendEvent(event(0, { type: "run.started" }));
    first.appendEvent(event(1, { type: "phase.started", phase: "integration" }));
    first.close();

    const reopened = new SqliteRunStore({ databasePath: path });
    const recovered = reopened.recoverInterruptedRuns();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.status).toBe("interrupted");
    expect(reopened.getSnapshot("persisted-run")?.steps[0]?.status).toBe("interrupted");
    expect(reopened.listEvents("persisted-run").at(-1)?.payload.type).toBe("run.interrupted");
    reopened.close();
  });

  it("stores delivery evidence, worktrees, sessions, and the final result", async () => {
    const store = new SqliteRunStore({ databasePath: await databasePath() });
    store.createDeliveryRun(request());
    store.appendEvent(event(0, { type: "run.started" }));
    store.appendEvent(
      event(1, {
        type: "job.queued",
        jobId: "persisted-run:hero",
        componentId: "hero",
      }),
    );
    const report = VerificationReportSchema.parse({
      schemaVersion: 1,
      runId: "persisted-run",
      componentId: "hero",
      verdict: "passed",
      attempt: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      gates: [
        {
          id: "desktop",
          label: "Desktop visual comparison",
          category: "visual",
          status: "passed",
          artifacts: [
            {
              artifactId: "persisted-run:hero:desktop",
              kind: "screenshot",
              path: "/tmp/artifacts/hero.png",
              mediaType: "image/png",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ],
    });
    const completedAt = new Date().toISOString();
    store.recordDeliveryResult(
      BatchDeliveryResultSchema.parse({
        schemaVersion: 1,
        runId: "persisted-run",
        status: "partial",
        startedAt: new Date().toISOString(),
        completedAt,
        jobs: [
          {
            status: "passed",
            jobId: "persisted-run:hero",
            componentId: "hero",
            worktree: {
              jobId: "persisted-run:hero",
              checkoutDir: "/tmp/worktrees/hero",
              workingDirectory: "/tmp/worktrees/hero",
              branch: "foundry/persisted-run/hero",
              baseCommit: sha,
            },
            changedFiles: [{ path: "src/components/sections/hero/Section.tsx", status: "A" }],
            reports: [report],
            commit: "c".repeat(40),
            sessionId: "session-hero",
          },
          {
            status: "failed",
            jobId: "persisted-run:cards",
            componentId: "cards",
            reports: [],
            code: "GENERATION_FAILED",
            message: "generation failed",
          },
        ],
      }),
    );

    const snapshot = store.getSnapshot("persisted-run");
    expect(snapshot?.run.status).toBe("partial");
    expect(snapshot?.run.result).toMatchObject({ status: "partial" });
    expect(snapshot?.verificationReports).toHaveLength(1);
    expect(snapshot?.artifacts).toMatchObject([
      { artifactId: "persisted-run:hero:desktop", path: "/tmp/artifacts/hero.png" },
    ]);
    expect(snapshot?.jobs.find(({ componentId }) => componentId === "hero")).toMatchObject({
      status: "passed",
      sessionId: "session-hero",
    });
    store.close();
  });
});
