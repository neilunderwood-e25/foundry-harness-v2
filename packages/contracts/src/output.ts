import { z } from "zod";
import {
  ArtifactIdSchema,
  ComponentIdSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  RelativeProjectPathSchema,
  RunIdSchema,
} from "./shared.js";

export const ArtifactRefSchema = z.object({
  artifactId: ArtifactIdSchema,
  kind: z.enum(["design", "screenshot", "visual-diff", "log", "report", "manifest", "other"]),
  path: NonEmptyStringSchema,
  mediaType: NonEmptyStringSchema,
  createdAt: IsoDateTimeSchema,
});

export const FieldBindingSchema = z.object({
  cmsField: NonEmptyStringSchema,
  graphqlPath: NonEmptyStringSchema,
  propPath: NonEmptyStringSchema,
  cardinality: z.enum(["one", "many"]),
  required: z.boolean(),
  transform: NonEmptyStringSchema.optional(),
});

export const SectionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  componentPath: RelativeProjectPathSchema,
  cmsType: NonEmptyStringSchema,
  variant: NonEmptyStringSchema,
  fragmentPath: RelativeProjectPathSchema,
  fragmentName: NonEmptyStringSchema,
  transformPath: RelativeProjectPathSchema,
  registryKey: NonEmptyStringSchema,
  bindings: z.array(FieldBindingSchema),
  ownedFiles: z.array(RelativeProjectPathSchema).min(1),
});

export const VerificationGateSchema = z.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  category: z.enum(["scope", "code", "foundation", "data", "visual", "accessibility", "runtime"]),
  status: z.enum(["passed", "failed", "skipped"]),
  repairable: z.boolean().optional(),
  detail: z.string().optional(),
  artifacts: z.array(ArtifactRefSchema).default([]),
});

export const VerificationReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  componentId: ComponentIdSchema,
  verdict: z.enum(["passed", "failed"]),
  attempt: z.number().int().positive(),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  gates: z.array(VerificationGateSchema).min(1),
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type FieldBinding = z.infer<typeof FieldBindingSchema>;
export type SectionManifest = z.infer<typeof SectionManifestSchema>;
export type VerificationGate = z.infer<typeof VerificationGateSchema>;
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
