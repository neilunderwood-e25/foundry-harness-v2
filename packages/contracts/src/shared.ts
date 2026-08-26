import { z } from "zod";

export const NonEmptyStringSchema = z.string().trim().min(1);
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/i, "Expected a full Git commit SHA");
export const FingerprintSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "Expected a SHA-256 fingerprint");

export const ProjectIdSchema = NonEmptyStringSchema.brand<"ProjectId">();
export const RunIdSchema = NonEmptyStringSchema.brand<"RunId">();
export const JobIdSchema = NonEmptyStringSchema.brand<"JobId">();
export const ComponentIdSchema = NonEmptyStringSchema.brand<"ComponentId">();
export const ArtifactIdSchema = NonEmptyStringSchema.brand<"ArtifactId">();

export const RelativeProjectPathSchema = NonEmptyStringSchema.superRefine((path, context) => {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    context.addIssue({ code: "custom", message: "Path must be relative to the project" });
  }
  if (path.split(/[\\/]/).includes("..")) {
    context.addIssue({ code: "custom", message: "Path cannot escape the project" });
  }
});

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type JobId = z.infer<typeof JobIdSchema>;
export type ComponentId = z.infer<typeof ComponentIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type RelativeProjectPath = z.infer<typeof RelativeProjectPathSchema>;
