import { z } from "zod";
import {
  BatchExecutionRequestSchema,
  ChangedFileSchema,
  WorktreeHandleSchema,
} from "./execution.js";
import { VerificationReportSchema } from "./output.js";
import { InputPreparationPolicySchema } from "./preparation.js";
import {
  ComponentIdSchema,
  JobIdSchema,
  NonEmptyStringSchema,
  RelativeProjectPathSchema,
  RunIdSchema,
  ShaSchema,
} from "./shared.js";

export const VerificationPolicySchema = z.object({
  installDependencies: z.boolean().default(true),
  runBuild: z.boolean().default(true),
  runTypecheck: z.boolean().default(true),
  runLint: z.boolean().default(true),
  runTests: z.boolean().default(false),
  commandTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(30 * 60_000)
    .default(5 * 60_000),
});

const RouteTemplateSchema = NonEmptyStringSchema.superRefine((value, context) => {
  if (!value.startsWith("/")) {
    context.addIssue({ code: "custom", message: "Preview route template must start with /" });
  }
  if (!value.includes("{slug}")) {
    context.addIssue({ code: "custom", message: "Preview route template must include {slug}" });
  }
});

const SelectorTemplateSchema = NonEmptyStringSchema.refine((value) => value.includes("{slug}"), {
  message: "Preview selector template must include {slug}",
});

export const QualityPolicySchema = z.object({
  enabled: z.boolean().default(false),
  routeTemplate: RouteTemplateSchema.default("/qa/{slug}"),
  selectorTemplate: SelectorTemplateSchema.default('[data-foundry="{slug}"]'),
  maxDiffRatio: z.number().min(0).max(1).default(0.03),
  pixelThreshold: z.number().min(0).max(1).default(0.1),
  runAccessibility: z.boolean().default(true),
  minimumAccessibilityImpact: z
    .enum(["minor", "moderate", "serious", "critical"])
    .default("serious"),
  startupTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(10 * 60_000)
    .default(90_000),
  navigationTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(5 * 60_000)
    .default(60_000),
  figmaTokenEnv:
    NonEmptyStringSchema.regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("FIGMA_ACCESS_TOKEN"),
});

export const BatchDeliveryRequestSchema = BatchExecutionRequestSchema.extend({
  inputPreparation: InputPreparationPolicySchema.default({
    enabled: false,
    fetchSampleEntry: true,
    failOnReview: true,
    requestTimeoutMs: 60_000,
    figmaTokenEnv: "FIGMA_ACCESS_TOKEN",
  }),
  verification: VerificationPolicySchema.default({
    installDependencies: true,
    runBuild: true,
    runTypecheck: true,
    runLint: true,
    runTests: false,
    commandTimeoutMs: 5 * 60_000,
  }),
  quality: QualityPolicySchema.default({
    enabled: false,
    routeTemplate: "/qa/{slug}",
    selectorTemplate: '[data-foundry="{slug}"]',
    maxDiffRatio: 0.03,
    pixelThreshold: 0.1,
    runAccessibility: true,
    minimumAccessibilityImpact: "serious",
    startupTimeoutMs: 90_000,
    navigationTimeoutMs: 60_000,
    figmaTokenEnv: "FIGMA_ACCESS_TOKEN",
  }),
});

export const DeliveredComponentSchema = z.object({
  status: z.literal("passed"),
  jobId: JobIdSchema,
  componentId: ComponentIdSchema,
  worktree: WorktreeHandleSchema,
  changedFiles: z.array(ChangedFileSchema).min(1),
  reports: z.array(VerificationReportSchema).min(1),
  commit: ShaSchema,
  sessionId: NonEmptyStringSchema.optional(),
});

export const FailedDeliveryComponentSchema = z.object({
  status: z.literal("failed"),
  jobId: JobIdSchema,
  componentId: ComponentIdSchema,
  worktree: WorktreeHandleSchema.optional(),
  reports: z.array(VerificationReportSchema).default([]),
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
});

export const CancelledDeliveryComponentSchema = z.object({
  status: z.literal("cancelled"),
  jobId: JobIdSchema,
  componentId: ComponentIdSchema,
  worktree: WorktreeHandleSchema.optional(),
  reports: z.array(VerificationReportSchema).default([]),
  message: NonEmptyStringSchema,
});

export const DeliveryComponentResultSchema = z.discriminatedUnion("status", [
  DeliveredComponentSchema,
  FailedDeliveryComponentSchema,
  CancelledDeliveryComponentSchema,
]);

export const IntegrationResultSchema = z.object({
  status: z.enum(["passed", "failed"]),
  branch: NonEmptyStringSchema,
  checkoutDir: NonEmptyStringSchema,
  baseCommit: ShaSchema,
  headCommit: ShaSchema.optional(),
  componentCommits: z.array(ShaSchema),
  generatedFiles: z.array(RelativeProjectPathSchema).default([]),
  gates: z.array(VerificationReportSchema).default([]),
  code: NonEmptyStringSchema.optional(),
  message: NonEmptyStringSchema.optional(),
});

export const BatchDeliveryResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  status: z.enum(["passed", "failed", "partial", "cancelled"]),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  jobs: z.array(DeliveryComponentResultSchema),
  integration: IntegrationResultSchema.optional(),
  code: NonEmptyStringSchema.optional(),
  message: NonEmptyStringSchema.optional(),
});

export type VerificationPolicy = z.infer<typeof VerificationPolicySchema>;
export type QualityPolicy = z.infer<typeof QualityPolicySchema>;
export type BatchDeliveryRequest = z.infer<typeof BatchDeliveryRequestSchema>;
export type DeliveredComponent = z.infer<typeof DeliveredComponentSchema>;
export type DeliveryComponentResult = z.infer<typeof DeliveryComponentResultSchema>;
export type IntegrationResult = z.infer<typeof IntegrationResultSchema>;
export type BatchDeliveryResult = z.infer<typeof BatchDeliveryResultSchema>;
