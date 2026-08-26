import { z } from "zod";
import {
  ArtifactIdSchema,
  ComponentIdSchema,
  IsoDateTimeSchema,
  JobIdSchema,
  NonEmptyStringSchema,
  RunIdSchema,
} from "./shared.js";

const RunEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.started") }),
  z.object({ type: z.literal("run.cancelled"), reason: NonEmptyStringSchema }),
  z.object({
    type: z.literal("run.completed"),
    status: z.enum(["completed", "passed", "failed", "partial"]),
  }),
  z.object({ type: z.literal("job.queued"), jobId: JobIdSchema, componentId: ComponentIdSchema }),
  z.object({ type: z.literal("job.started"), jobId: JobIdSchema, componentId: ComponentIdSchema }),
  z.object({
    type: z.literal("job.cancelled"),
    jobId: JobIdSchema,
    componentId: ComponentIdSchema,
    reason: NonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("job.failed"),
    jobId: JobIdSchema,
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("job.completed"),
    jobId: JobIdSchema,
    componentId: ComponentIdSchema,
  }),
  z.object({
    type: z.literal("phase.started"),
    jobId: JobIdSchema.optional(),
    phase: NonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("phase.completed"),
    jobId: JobIdSchema.optional(),
    phase: NonEmptyStringSchema,
  }),
  z.object({ type: z.literal("agent.text"), jobId: JobIdSchema, text: z.string() }),
  z.object({
    type: z.literal("agent.tool.started"),
    jobId: JobIdSchema,
    tool: NonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("agent.tool.completed"),
    jobId: JobIdSchema,
    tool: NonEmptyStringSchema,
    ok: z.boolean(),
  }),
  z.object({
    type: z.literal("verification.completed"),
    jobId: JobIdSchema,
    verdict: z.enum(["passed", "failed"]),
  }),
  z.object({
    type: z.literal("artifact.created"),
    jobId: JobIdSchema.optional(),
    artifactId: ArtifactIdSchema,
  }),
]);

export const RunEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: NonEmptyStringSchema,
  runId: RunIdSchema,
  sequence: z.number().int().nonnegative(),
  occurredAt: IsoDateTimeSchema,
  payload: RunEventPayloadSchema,
});

export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
