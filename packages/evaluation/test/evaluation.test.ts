import {
  BatchDeliveryRequestSchema,
  DurableRunSnapshotSchema,
  type DurableRunSnapshot,
} from "@foundry/contracts";
import { describe, expect, it } from "vitest";
import { evaluateRuns } from "../src/index.js";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

function snapshot(
  status: "passed" | "failed",
  attempts: ("passed" | "failed")[],
): DurableRunSnapshot {
  const component = (slug: string) => ({
    schemaVersion: 1 as const,
    runId: `evaluation-${status}`,
    componentId: slug,
    projectId: "evaluation-project",
    baseCommit: sha,
    foundationFingerprint: fingerprint,
    name: slug,
    slug,
    design: {
      desktopFrameUrl: `https://figma.com/design/file/Test?node-id=${slug}-1`,
      mobileFrameUrl: `https://figma.com/design/file/Test?node-id=${slug}-2`,
    },
    cms: {
      provider: "contentful" as const,
      contentType: slug,
      variantField: "kind",
      variantValue: slug,
    },
    agent: { provider: "codex" as const },
  });
  const request = BatchDeliveryRequestSchema.parse({
    schemaVersion: 1,
    project: {
      schemaVersion: 1,
      projectId: "evaluation-project",
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
      projectId: "evaluation-project",
      status: "ready",
      sourceCommit: sha,
      fingerprint,
      reasons: [],
      styleGuide: {
        source: "existing",
        files: ["tokens.css"],
        colors: [],
        spacing: [],
        typography: [],
        breakpoints: {},
        primitives: [],
      },
      container: {
        source: "existing",
        componentPath: "Container.tsx",
        importPath: "@/Container",
        desktopMaxWidth: "fluid",
        mobileMaxWidth: "fluid",
        paddingByBreakpoint: {},
        supportsFullBleed: false,
        supportedProps: ["children"],
      },
    },
    batch: {
      schemaVersion: 1,
      runId: `evaluation-${status}`,
      projectId: "evaluation-project",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 1,
      components: [component("hero"), component("cards")],
    },
    worktreeRoot: "/tmp/worktrees",
  });
  const now = "2026-01-01T00:00:00.000Z";
  return DurableRunSnapshotSchema.parse({
    run: {
      schemaVersion: 1,
      runId: request.batch.runId,
      projectId: "evaluation-project",
      kind: "delivery",
      status,
      cancelRequested: false,
      request,
      createdAt: now,
      updatedAt: now,
    },
    jobs: [
      {
        jobId: `${request.batch.runId}:hero`,
        runId: request.batch.runId,
        componentId: "hero",
        status,
        createdAt: now,
        updatedAt: now,
      },
    ],
    steps: [],
    events: [],
    artifacts: [],
    verificationReports: attempts.map((verdict, index) => ({
      schemaVersion: 1,
      runId: request.batch.runId,
      componentId: "hero",
      verdict,
      attempt: index + 1,
      startedAt: now,
      completedAt: now,
      gates: [
        {
          id: "visual:desktop",
          label: "Desktop",
          category: "visual",
          status: verdict,
          artifacts: [],
        },
        {
          id: "accessibility",
          label: "Accessibility",
          category: "accessibility",
          status: "passed",
          artifacts: [],
        },
      ],
    })),
  });
}

describe("evaluation reports", () => {
  it("measures first-turn and repair success and applies thresholds", () => {
    const report = evaluateRuns(
      [snapshot("passed", ["failed", "passed"]), snapshot("passed", ["passed"])],
      { minimumRuns: 2 },
      () => new Date("2026-01-02T00:00:00.000Z"),
    );
    expect(report.metrics).toMatchObject({
      runs: 2,
      runPassRate: 1,
      componentPassRate: 1,
      firstTurnSuccessRate: 0.5,
      repairSuccessRate: 1,
    });
    expect(report.providers).toMatchObject([{ provider: "codex", components: 2, passRate: 1 }]);
    expect(report.verdict).toBe("passed");
  });

  it("fails an empty evaluation sample", () => {
    expect(evaluateRuns([]).verdict).toBe("failed");
  });
});
