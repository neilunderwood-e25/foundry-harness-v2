import { z } from "zod";
import { BatchBuildSpecSchema } from "./build.js";
import { ReadyProjectFoundationSchema, ProjectProfileSchema } from "./project.js";
import { PreparedComponentInputsSchema } from "./preparation.js";
import {
  ComponentIdSchema,
  JobIdSchema,
  NonEmptyStringSchema,
  RelativeProjectPathSchema,
  RunIdSchema,
  ShaSchema,
} from "./shared.js";

export const AgentProviderNameSchema = z.enum(["codex", "claude"]);

export const AgentProviderCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  sessions: z.boolean(),
  toolEvents: z.boolean(),
  cancellation: z.boolean(),
});

export const WorktreeHandleSchema = z.object({
  jobId: JobIdSchema,
  checkoutDir: NonEmptyStringSchema,
  workingDirectory: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  baseCommit: ShaSchema,
});

export const ChangedFileSchema = z.object({
  path: RelativeProjectPathSchema,
  status: NonEmptyStringSchema,
});

export const ComponentJobResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    jobId: JobIdSchema,
    componentId: ComponentIdSchema,
    provider: AgentProviderNameSchema,
    worktree: WorktreeHandleSchema,
    changedFiles: z.array(ChangedFileSchema),
    sessionId: NonEmptyStringSchema.optional(),
    summary: z.string().optional(),
  }),
  z.object({
    status: z.literal("failed"),
    jobId: JobIdSchema,
    componentId: ComponentIdSchema,
    provider: AgentProviderNameSchema,
    worktree: WorktreeHandleSchema.optional(),
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
  }),
  z.object({
    status: z.literal("cancelled"),
    jobId: JobIdSchema,
    componentId: ComponentIdSchema,
    provider: AgentProviderNameSchema,
    worktree: WorktreeHandleSchema.optional(),
    message: NonEmptyStringSchema,
  }),
]);

export const BatchExecutionResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  status: z.enum(["completed", "failed", "partial", "cancelled"]),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  jobs: z.array(ComponentJobResultSchema),
});

export const BatchExecutionRequestSchema = z.object({
  schemaVersion: z.literal(1),
  project: ProjectProfileSchema,
  foundation: ReadyProjectFoundationSchema,
  batch: BatchBuildSpecSchema,
  worktreeRoot: NonEmptyStringSchema,
  preparedInputs: PreparedComponentInputsSchema.optional(),
});

export type AgentProviderName = z.infer<typeof AgentProviderNameSchema>;
export type AgentProviderCapabilities = z.infer<typeof AgentProviderCapabilitiesSchema>;
export type WorktreeHandle = z.infer<typeof WorktreeHandleSchema>;
export type ChangedFile = z.infer<typeof ChangedFileSchema>;
export type ComponentJobResult = z.infer<typeof ComponentJobResultSchema>;
export type BatchExecutionResult = z.infer<typeof BatchExecutionResultSchema>;
export type BatchExecutionRequest = z.infer<typeof BatchExecutionRequestSchema>;
