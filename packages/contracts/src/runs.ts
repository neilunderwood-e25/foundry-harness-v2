import { z } from "zod";
import {
  ComponentIdSchema,
  IsoDateTimeSchema,
  JobIdSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
} from "./shared.js";
import { RunEventSchema } from "./events.js";
import { ArtifactRefSchema, VerificationReportSchema } from "./output.js";

export const DurableRunKindSchema = z.enum(["execution", "delivery"]);

export const DurableRunStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "completed",
  "passed",
  "failed",
  "partial",
  "cancelled",
  "interrupted",
]);

export const DurableRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  projectId: ProjectIdSchema,
  kind: DurableRunKindSchema,
  status: DurableRunStatusSchema,
  cancelRequested: z.boolean(),
  request: z.unknown(),
  result: z.unknown().optional(),
  errorCode: NonEmptyStringSchema.optional(),
  errorMessage: NonEmptyStringSchema.optional(),
  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema,
});

export const DurableJobSchema = z.object({
  jobId: JobIdSchema,
  runId: RunIdSchema,
  componentId: ComponentIdSchema,
  status: z.enum(["queued", "running", "completed", "passed", "failed", "cancelled"]),
  errorCode: NonEmptyStringSchema.optional(),
  errorMessage: NonEmptyStringSchema.optional(),
  worktree: z.unknown().optional(),
  sessionId: NonEmptyStringSchema.optional(),
  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
  updatedAt: IsoDateTimeSchema,
});

export const WorkflowStepSchema = z.object({
  stepId: NonEmptyStringSchema,
  runId: RunIdSchema,
  jobId: JobIdSchema.optional(),
  phase: NonEmptyStringSchema,
  status: z.enum(["running", "completed", "interrupted"]),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
});

export const DurableRunSnapshotSchema = z.object({
  run: DurableRunSchema,
  jobs: z.array(DurableJobSchema),
  steps: z.array(WorkflowStepSchema),
  events: z.array(RunEventSchema),
  artifacts: z.array(ArtifactRefSchema),
  verificationReports: z.array(VerificationReportSchema),
});

export const RunCancellationSchema = z.object({
  runId: RunIdSchema,
  accepted: z.boolean(),
  status: DurableRunStatusSchema,
  message: NonEmptyStringSchema,
});

export type DurableRunKind = z.infer<typeof DurableRunKindSchema>;
export type DurableRunStatus = z.infer<typeof DurableRunStatusSchema>;
export type DurableRun = z.infer<typeof DurableRunSchema>;
export type DurableJob = z.infer<typeof DurableJobSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type DurableRunSnapshot = z.infer<typeof DurableRunSnapshotSchema>;
export type RunCancellation = z.infer<typeof RunCancellationSchema>;
