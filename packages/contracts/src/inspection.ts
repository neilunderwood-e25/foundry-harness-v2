import { z } from "zod";
import { FoundationSetupSpecSchema } from "./foundation-setup.js";
import { ProjectFoundationSchema } from "./project.js";
import { ProjectProfileSchema } from "./project.js";
import { NonEmptyStringSchema, ProjectIdSchema, RelativeProjectPathSchema } from "./shared.js";

export const ProjectInspectionRequestSchema = z.object({
  rootDir: NonEmptyStringSchema,
  projectId: ProjectIdSchema.optional(),
});

export const FoundationInspectionRequestSchema = ProjectInspectionRequestSchema.extend({
  previous: ProjectFoundationSchema.optional(),
  acceptChanges: z.boolean().default(false),
});

export const FoundationSetupRequestSchema = z.object({
  rootDir: NonEmptyStringSchema,
  specification: FoundationSetupSpecSchema,
  overwrite: z.boolean().default(false),
});

export const ReadinessDiagnosticSchema = z.object({
  code: NonEmptyStringSchema,
  severity: z.enum(["error", "warning", "info"]),
  message: NonEmptyStringSchema,
  path: RelativeProjectPathSchema.optional(),
});

export const InspectionEvidenceSchema = z.object({
  kind: z.enum([
    "manifest",
    "lockfile",
    "router",
    "section-root",
    "registry",
    "graphql",
    "cms",
    "style-guide",
    "container",
  ]),
  path: RelativeProjectPathSchema,
  detail: NonEmptyStringSchema.optional(),
});

const InspectionCoreSchema = z.object({
  schemaVersion: z.literal(1),
  rootDir: NonEmptyStringSchema,
  diagnostics: z.array(ReadinessDiagnosticSchema),
  evidence: z.array(InspectionEvidenceSchema),
});

export const ProjectInspectionSchema = z.discriminatedUnion("status", [
  InspectionCoreSchema.extend({
    status: z.literal("supported"),
    profile: ProjectProfileSchema,
  }),
  InspectionCoreSchema.extend({
    status: z.literal("unsupported"),
  }),
]);

export type ReadinessDiagnostic = z.infer<typeof ReadinessDiagnosticSchema>;
export type InspectionEvidence = z.infer<typeof InspectionEvidenceSchema>;
export type ProjectInspectionRequest = z.infer<typeof ProjectInspectionRequestSchema>;
export type FoundationInspectionRequest = z.infer<typeof FoundationInspectionRequestSchema>;
export type FoundationSetupRequest = z.infer<typeof FoundationSetupRequestSchema>;
export type ProjectInspection = z.infer<typeof ProjectInspectionSchema>;
export type SupportedProjectInspection = Extract<ProjectInspection, { status: "supported" }>;
