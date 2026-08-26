import { z } from "zod";
import {
  BatchExecutionRequestSchema,
  ChangedFileSchema,
  WorktreeHandleSchema,
} from "./execution.js";
import { VerificationReportSchema } from "./output.js";
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

export const BatchDeliveryRequestSchema = BatchExecutionRequestSchema.extend({
  verification: VerificationPolicySchema.default({
    installDependencies: true,
    runBuild: true,
    runTypecheck: true,
    runLint: true,
    runTests: false,
    commandTimeoutMs: 5 * 60_000,
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
export type BatchDeliveryRequest = z.infer<typeof BatchDeliveryRequestSchema>;
export type DeliveredComponent = z.infer<typeof DeliveredComponentSchema>;
export type DeliveryComponentResult = z.infer<typeof DeliveryComponentResultSchema>;
export type IntegrationResult = z.infer<typeof IntegrationResultSchema>;
export type BatchDeliveryResult = z.infer<typeof BatchDeliveryResultSchema>;
