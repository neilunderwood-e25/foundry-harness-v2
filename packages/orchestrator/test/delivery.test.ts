import { AgentProviderRegistry, type AgentProvider } from "@foundry/agent-runtime";
import {
  BatchDeliveryRequestSchema,
  BatchExecutionResultSchema,
  VerificationReportSchema,
  type BatchDeliveryRequest,
  type ChangedFile,
  type DeliveredComponent,
  type IntegrationResult,
  type RunEvent,
  type VerificationReport,
  type WorktreeHandle,
} from "@foundry/contracts";
import { describe, expect, it } from "vitest";
import {
  BatchDeliveryPipeline,
  type DeliveryIntegrator,
  type DeliveryVerifier,
  type GenerationExecutor,
} from "../src/index.js";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

function deliveryRequest(): BatchDeliveryRequest {
  const component = (slug: string) => ({
    schemaVersion: 1 as const,
    runId: "delivery-1",
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
      runId: "delivery-1",
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: [component("hero"), component("cards")],
    },
    worktreeRoot: "/tmp/worktrees",
    verification: {
      installDependencies: false,
      runBuild: false,
      runTypecheck: false,
      runLint: false,
      runTests: false,
      commandTimeoutMs: 10_000,
    },
  });
}

function handle(slug: string): WorktreeHandle {
  const checkoutDir = `/tmp/worktrees/${slug}`;
  return {
    jobId: `delivery-1:${slug}` as WorktreeHandle["jobId"],
    checkoutDir,
    workingDirectory: checkoutDir,
    branch: `foundry/delivery-1/${slug}`,
    baseCommit: sha,
  };
}

function report(componentId: string, attempt: number): VerificationReport {
  const passed = attempt === 2;
  return VerificationReportSchema.parse({
    schemaVersion: 1,
    runId: "delivery-1",
    componentId,
    verdict: passed ? "passed" : "failed",
    attempt,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    gates: [
      {
        id: "manifest",
        label: "Section manifest",
        category: "data",
        status: passed ? "passed" : "failed",
        detail: passed ? "fixed" : "ownedFiles is incomplete",
        artifacts: [],
      },
    ],
  });
}

class FakeGeneration implements GenerationExecutor {
  async execute(request: BatchDeliveryRequest) {
    return BatchExecutionResultSchema.parse({
      schemaVersion: 1,
      runId: request.batch.runId,
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      jobs: request.batch.components.map((component) => ({
        status: "completed",
        jobId: `${request.batch.runId}:${component.componentId}`,
        componentId: component.componentId,
        provider: "codex",
        worktree: handle(component.slug),
        changedFiles: [
          {
            status: "??",
            path: `src/components/sections/${component.slug}/Section.tsx`,
          },
        ],
        sessionId: `session-${component.slug}`,
      })),
    });
  }
}

class FakeVerifier implements DeliveryVerifier {
  async verify(input: Parameters<DeliveryVerifier["verify"]>[0]) {
    return report(input.specification.componentId, input.attempt);
  }
}

class FakeIntegrator implements DeliveryIntegrator {
  async changedFiles(worktree: WorktreeHandle): Promise<ChangedFile[]> {
    const slug = worktree.branch.split("/").at(-1)!;
    return [{ status: "??", path: `src/components/sections/${slug}/Section.tsx` }];
  }

  async commitComponent(worktree: WorktreeHandle): Promise<string> {
    return worktree.branch.endsWith("hero") ? "c".repeat(40) : "d".repeat(40);
  }

  async integrate(
    request: BatchDeliveryRequest,
    components: readonly DeliveredComponent[],
  ): Promise<IntegrationResult> {
    return {
      status: "passed",
      branch: "foundry/delivery-1/integration",
      checkoutDir: "/tmp/worktrees/delivery-1/integration",
      baseCommit: request.batch.baseCommit,
      headCommit: "e".repeat(40),
      componentCommits: components.map(({ commit }) => commit),
      generatedFiles: ["src/components/sections/foundry.registry.generated.ts"],
      gates: [],
    };
  }
}

describe("batch delivery pipeline", () => {
  it("repairs failed gates in the same sessions, commits passed jobs, and integrates once", async () => {
    const sessions: Array<string | undefined> = [];
    const provider: AgentProvider = {
      name: "codex",
      capabilities: { streaming: true, sessions: true, toolEvents: true, cancellation: true },
      async execute(input) {
        sessions.push(input.sessionId);
        return {
          status: "completed",
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        };
      },
    };
    const events: RunEvent[] = [];
    const result = await new BatchDeliveryPipeline({
      providers: new AgentProviderRegistry([provider]),
      executor: new FakeGeneration(),
      verifier: new FakeVerifier(),
      integrator: new FakeIntegrator(),
    }).deliver(deliveryRequest(), {
      onEvent(event) {
        events.push(event);
      },
    });

    expect(result.status).toBe("passed");
    expect(result.jobs.every(({ status }) => status === "passed")).toBe(true);
    expect(result.jobs.map(({ reports }) => reports).every((reports) => reports.length === 2)).toBe(
      true,
    );
    expect(sessions.sort()).toEqual(["session-cards", "session-hero"]);
    expect(result.integration?.componentCommits).toEqual(["c".repeat(40), "d".repeat(40)]);
    expect(events.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index),
    );
    expect(events.at(-1)?.payload).toEqual({ type: "run.completed", status: "passed" });
  });
});
