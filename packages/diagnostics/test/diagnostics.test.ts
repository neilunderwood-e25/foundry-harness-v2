import { DurableRunSnapshotSchema } from "@foundry/contracts";
import { describe, expect, it } from "vitest";
import { createDiagnosticsBundle } from "../src/index.js";

describe("diagnostics bundle", () => {
  it("redacts secrets and omits artifact contents", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const snapshot = DurableRunSnapshotSchema.parse({
      run: {
        schemaVersion: 1,
        runId: "diagnostic-run",
        projectId: "project",
        kind: "delivery",
        status: "failed",
        cancelRequested: false,
        request: { token: "top-secret-value" },
        errorMessage: "Bearer abcdefghijkl",
        createdAt: now,
        updatedAt: now,
      },
      jobs: [],
      steps: [],
      events: [],
      artifacts: [],
      verificationReports: [],
    });
    const bundle = createDiagnosticsBundle(snapshot, () => new Date(now));
    expect(bundle.snapshot.run.request).toEqual({ token: "[REDACTED]" });
    expect(bundle.snapshot.run.errorMessage).toBe("[REDACTED]");
    expect(bundle.policy.artifactContentsIncluded).toBe(false);
  });
});
