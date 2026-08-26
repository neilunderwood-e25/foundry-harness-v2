import { z } from "zod";
import {
  ComponentIdSchema,
  FingerprintSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RunIdSchema,
  ShaSchema,
} from "./shared.js";

const FigmaFrameUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) {
    context.addIssue({ code: "custom", message: "Expected a figma.com URL" });
  }
  if (!url.searchParams.get("node-id")) {
    context.addIssue({ code: "custom", message: "Figma URL must include node-id" });
  }
});

export const AgentSelectionSchema = z.object({
  provider: z.enum(["codex", "claude"]),
  model: NonEmptyStringSchema.optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  maxRepairTurns: z.number().int().min(0).max(10).default(3),
});

export const CmsTypeRefSchema = z.object({
  provider: z.enum(["contentful", "contentstack"]),
  contentType: NonEmptyStringSchema,
  graphqlType: NonEmptyStringSchema.optional(),
  variantField: NonEmptyStringSchema,
  variantValue: NonEmptyStringSchema,
});

export const ComponentBuildSpecSchema = z.object({
  schemaVersion: z.literal(1),
  runId: RunIdSchema,
  componentId: ComponentIdSchema,
  projectId: ProjectIdSchema,
  baseCommit: ShaSchema,
  foundationFingerprint: FingerprintSchema,
  name: NonEmptyStringSchema,
  slug: NonEmptyStringSchema.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  design: z.object({
    desktopFrameUrl: FigmaFrameUrlSchema,
    mobileFrameUrl: FigmaFrameUrlSchema,
  }),
  cms: CmsTypeRefSchema,
  agent: AgentSelectionSchema,
});

export const BatchBuildSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: RunIdSchema,
    projectId: ProjectIdSchema,
    baseCommit: ShaSchema,
    foundationFingerprint: FingerprintSchema,
    maxParallel: z.number().int().min(1).max(16),
    components: z.array(ComponentBuildSpecSchema).min(2),
  })
  .superRefine((batch, context) => {
    const componentIds = new Set<string>();
    const slugs = new Set<string>();

    batch.components.forEach((component, index) => {
      const path = ["components", index] as const;
      if (component.runId !== batch.runId) {
        context.addIssue({
          code: "custom",
          path: [...path, "runId"],
          message: "Run ID must match batch",
        });
      }
      if (component.projectId !== batch.projectId) {
        context.addIssue({
          code: "custom",
          path: [...path, "projectId"],
          message: "Project must match batch",
        });
      }
      if (component.baseCommit !== batch.baseCommit) {
        context.addIssue({
          code: "custom",
          path: [...path, "baseCommit"],
          message: "Base commit must match batch",
        });
      }
      if (component.foundationFingerprint !== batch.foundationFingerprint) {
        context.addIssue({
          code: "custom",
          path: [...path, "foundationFingerprint"],
          message: "Foundation fingerprint must match batch",
        });
      }
      if (componentIds.has(component.componentId)) {
        context.addIssue({
          code: "custom",
          path: [...path, "componentId"],
          message: "Component ID must be unique",
        });
      }
      if (slugs.has(component.slug)) {
        context.addIssue({
          code: "custom",
          path: [...path, "slug"],
          message: "Component slug must be unique",
        });
      }
      componentIds.add(component.componentId);
      slugs.add(component.slug);
    });
  });

export type AgentSelection = z.infer<typeof AgentSelectionSchema>;
export type CmsTypeRef = z.infer<typeof CmsTypeRefSchema>;
export type ComponentBuildSpec = z.infer<typeof ComponentBuildSpecSchema>;
export type BatchBuildSpec = z.infer<typeof BatchBuildSpecSchema>;
