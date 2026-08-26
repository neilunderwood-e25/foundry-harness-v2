import {
  BatchDeliveryRequestSchema,
  EvaluationMetricsSchema,
  EvaluationPolicySchema,
  EvaluationReportSchema,
  ProviderEvaluationSchema,
  type DurableRunSnapshot,
  type EvaluationPolicy,
  type EvaluationReport,
  type EvaluationThreshold,
  type VerificationReport,
} from "@foundry/contracts";

interface ComponentObservation {
  readonly provider: string;
  readonly passed: boolean;
  readonly durationMs?: number;
  readonly reports: readonly VerificationReport[];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function failureRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function componentDurations(snapshot: DurableRunSnapshot): Map<string, number> {
  const started = new Map<string, number>();
  const durations = new Map<string, number>();
  for (const event of snapshot.events) {
    const payload = event.payload;
    if (payload.type === "job.started") started.set(payload.jobId, Date.parse(event.occurredAt));
    if (
      payload.type === "job.completed" ||
      payload.type === "job.failed" ||
      payload.type === "job.cancelled"
    ) {
      const start = started.get(payload.jobId);
      if (start !== undefined)
        durations.set(payload.jobId, Math.max(0, Date.parse(event.occurredAt) - start));
    }
  }
  return durations;
}

function observations(snapshots: readonly DurableRunSnapshot[]): ComponentObservation[] {
  const result: ComponentObservation[] = [];
  for (const snapshot of snapshots) {
    const request = BatchDeliveryRequestSchema.safeParse(snapshot.run.request);
    const providers = new Map(
      request.success
        ? request.data.batch.components.map((component) => [
            component.componentId,
            component.agent.provider,
          ])
        : [],
    );
    const durations = componentDurations(snapshot);
    for (const job of snapshot.jobs) {
      result.push({
        provider: providers.get(job.componentId) ?? "unknown",
        passed: job.status === "passed" || job.status === "completed",
        ...(durations.has(job.jobId) ? { durationMs: durations.get(job.jobId)! } : {}),
        reports: snapshot.verificationReports
          .filter(({ componentId }) => componentId === job.componentId)
          .sort((left, right) => left.attempt - right.attempt),
      });
    }
  }
  return result;
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function threshold(
  id: string,
  label: string,
  actual: number,
  target: number,
  operator: ">=" | "<=",
): EvaluationThreshold {
  return {
    id,
    label,
    actual,
    target,
    operator,
    passed: operator === ">=" ? actual >= target : actual <= target,
  };
}

export function evaluateRuns(
  snapshots: readonly DurableRunSnapshot[],
  policyInput: Partial<EvaluationPolicy> = {},
  clock: () => Date = () => new Date(),
): EvaluationReport {
  const policy = EvaluationPolicySchema.parse(policyInput);
  const components = observations(snapshots);
  const passedRuns = snapshots.filter(({ run }) => run.status === "passed").length;
  const passedComponents = components.filter(({ passed }) => passed).length;
  const firstTurn = components.filter(
    ({ reports: componentReports }) => componentReports[0]?.verdict === "passed",
  );
  const repairCandidates = components.filter(
    ({ reports: componentReports }) => componentReports[0]?.verdict === "failed",
  );
  const repaired = repairCandidates.filter(({ reports: componentReports }) =>
    componentReports.slice(1).some(({ verdict }) => verdict === "passed"),
  );
  const finalReports = components.flatMap(
    ({ reports: componentReports }) => componentReports.at(-1) ?? [],
  );
  const visualGates = finalReports.flatMap(({ gates }) =>
    gates.filter(({ category }) => category === "visual"),
  );
  const accessibilityGates = finalReports.flatMap(({ gates }) =>
    gates.filter(({ category }) => category === "accessibility"),
  );
  const integrations = snapshots
    .map(({ run }) => run.result)
    .filter(
      (result): result is Record<string, unknown> => typeof result === "object" && result !== null,
    )
    .map((result) => result["integration"])
    .filter(
      (integration): integration is Record<string, unknown> =>
        typeof integration === "object" && integration !== null,
    );
  const conflicts = integrations.filter((integration) =>
    `${integration["code"] ?? ""} ${integration["message"] ?? ""}`
      .toLowerCase()
      .includes("conflict"),
  ).length;

  const metrics = EvaluationMetricsSchema.parse({
    runs: snapshots.length,
    passedRuns,
    runPassRate: ratio(passedRuns, snapshots.length),
    components: components.length,
    passedComponents,
    componentPassRate: ratio(passedComponents, components.length),
    firstTurnSuccessRate: ratio(firstTurn.length, components.length),
    repairSuccessRate: ratio(repaired.length, repairCandidates.length),
    visualGatePassRate: ratio(
      visualGates.filter(({ status }) => status === "passed").length,
      visualGates.length,
    ),
    accessibilityGatePassRate: ratio(
      accessibilityGates.filter(({ status }) => status === "passed").length,
      accessibilityGates.length,
    ),
    mergeConflictRate: failureRatio(conflicts, integrations.length),
    averageComponentRuntimeMs: average(
      components.flatMap(({ durationMs }) => (durationMs === undefined ? [] : [durationMs])),
    ),
  });

  const providers = [...new Set(components.map(({ provider }) => provider))]
    .sort()
    .map((provider) => {
      const providerComponents = components.filter((component) => component.provider === provider);
      const providerPassed = providerComponents.filter(({ passed }) => passed).length;
      return ProviderEvaluationSchema.parse({
        provider,
        components: providerComponents.length,
        passedComponents: providerPassed,
        passRate: ratio(providerPassed, providerComponents.length),
        averageRuntimeMs: average(
          providerComponents.flatMap(({ durationMs }) =>
            durationMs === undefined ? [] : [durationMs],
          ),
        ),
      });
    });

  const thresholds = [
    threshold("sample-size", "Evaluated runs", metrics.runs, policy.minimumRuns, ">="),
    threshold(
      "run-pass-rate",
      "Run pass rate",
      metrics.runPassRate,
      policy.minimumRunPassRate,
      ">=",
    ),
    threshold(
      "component-pass-rate",
      "Component pass rate",
      metrics.componentPassRate,
      policy.minimumComponentPassRate,
      ">=",
    ),
    threshold(
      "first-turn-success",
      "First-turn success",
      metrics.firstTurnSuccessRate,
      policy.minimumFirstTurnSuccessRate,
      ">=",
    ),
    threshold(
      "visual-gates",
      "Visual gate pass rate",
      metrics.visualGatePassRate,
      policy.minimumVisualGatePassRate,
      ">=",
    ),
    threshold(
      "accessibility-gates",
      "Accessibility gate pass rate",
      metrics.accessibilityGatePassRate,
      policy.minimumAccessibilityGatePassRate,
      ">=",
    ),
    threshold(
      "merge-conflicts",
      "Merge-conflict rate",
      metrics.mergeConflictRate,
      policy.maximumMergeConflictRate,
      "<=",
    ),
  ];

  return EvaluationReportSchema.parse({
    schemaVersion: 1,
    generatedAt: clock().toISOString(),
    verdict: thresholds.every(({ passed }) => passed) ? "passed" : "failed",
    metrics,
    providers,
    thresholds,
  });
}
