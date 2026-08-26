import { z } from "zod";
import { IsoDateTimeSchema, NonEmptyStringSchema } from "./shared.js";

const RateSchema = z.number().min(0).max(1);

export const EvaluationPolicySchema = z.object({
  minimumRuns: z.number().int().nonnegative().default(1),
  minimumRunPassRate: RateSchema.default(0.8),
  minimumComponentPassRate: RateSchema.default(0.8),
  minimumFirstTurnSuccessRate: RateSchema.default(0.5),
  minimumVisualGatePassRate: RateSchema.default(0.9),
  minimumAccessibilityGatePassRate: RateSchema.default(1),
  maximumMergeConflictRate: RateSchema.default(0.05),
});

export const EvaluationMetricsSchema = z.object({
  runs: z.number().int().nonnegative(),
  passedRuns: z.number().int().nonnegative(),
  runPassRate: RateSchema,
  components: z.number().int().nonnegative(),
  passedComponents: z.number().int().nonnegative(),
  componentPassRate: RateSchema,
  firstTurnSuccessRate: RateSchema,
  repairSuccessRate: RateSchema,
  visualGatePassRate: RateSchema,
  accessibilityGatePassRate: RateSchema,
  mergeConflictRate: RateSchema,
  averageComponentRuntimeMs: z.number().nonnegative().nullable(),
});

export const ProviderEvaluationSchema = z.object({
  provider: NonEmptyStringSchema,
  components: z.number().int().nonnegative(),
  passedComponents: z.number().int().nonnegative(),
  passRate: RateSchema,
  averageRuntimeMs: z.number().nonnegative().nullable(),
});

export const EvaluationThresholdSchema = z.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  actual: z.number().nonnegative(),
  target: z.number().nonnegative(),
  operator: z.enum([">=", "<="]),
  passed: z.boolean(),
});

export const EvaluationReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: IsoDateTimeSchema,
  verdict: z.enum(["passed", "failed"]),
  metrics: EvaluationMetricsSchema,
  providers: z.array(ProviderEvaluationSchema),
  thresholds: z.array(EvaluationThresholdSchema),
});

export type EvaluationPolicy = z.infer<typeof EvaluationPolicySchema>;
export type EvaluationMetrics = z.infer<typeof EvaluationMetricsSchema>;
export type ProviderEvaluation = z.infer<typeof ProviderEvaluationSchema>;
export type EvaluationThreshold = z.infer<typeof EvaluationThresholdSchema>;
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;
