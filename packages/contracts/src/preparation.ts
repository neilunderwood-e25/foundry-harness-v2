import { z } from "zod";
import { ArtifactRefSchema, FieldBindingSchema } from "./output.js";
import {
  ComponentIdSchema,
  FingerprintSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  RelativeProjectPathSchema,
} from "./shared.js";

export const DesignColorObservationSchema = z.object({
  value: NonEmptyStringSchema,
  occurrences: z.number().int().positive(),
  styleName: NonEmptyStringSchema.optional(),
});

export const TypographyObservationSchema = z.object({
  fontFamily: NonEmptyStringSchema,
  fontSize: z.number().positive(),
  fontWeight: z.number().int().min(1).max(1000),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.number().optional(),
  occurrences: z.number().int().positive(),
  styleName: NonEmptyStringSchema.optional(),
});

export const SpacingObservationSchema = z.object({
  value: z.number().nonnegative(),
  occurrences: z.number().int().positive(),
});

export const DesignComponentInstanceSchema = z.object({
  nodeId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  componentId: NonEmptyStringSchema.optional(),
  componentName: NonEmptyStringSchema.optional(),
});

export const DesignAssetObservationSchema = z.object({
  nodeId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  kind: z.enum(["image-fill", "vector"]),
  imageRef: NonEmptyStringSchema.optional(),
  artifact: ArtifactRefSchema.optional(),
});

export const DesignFrameSnapshotSchema = z.object({
  sourceUrl: z.url(),
  fileKey: NonEmptyStringSchema,
  nodeId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  width: z.number().positive(),
  height: z.number().positive(),
  layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"]).optional(),
  childCount: z.number().int().nonnegative(),
  nodeDigest: FingerprintSchema,
  nodeTypeCounts: z.record(NonEmptyStringSchema, z.number().int().positive()),
  colors: z.array(DesignColorObservationSchema),
  typography: z.array(TypographyObservationSchema),
  spacing: z.array(SpacingObservationSchema),
  componentInstances: z.array(DesignComponentInstanceSchema),
  assets: z.array(DesignAssetObservationSchema),
  screenshot: ArtifactRefSchema,
});

export const DesignSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  capturedAt: IsoDateTimeSchema,
  digest: FingerprintSchema,
  desktop: DesignFrameSnapshotSchema,
  mobile: DesignFrameSnapshotSchema,
  artifacts: z.array(ArtifactRefSchema).min(2),
});

export const CmsFieldKindSchema = z.enum([
  "text",
  "rich-text",
  "integer",
  "number",
  "boolean",
  "date",
  "json",
  "location",
  "asset",
  "reference",
  "group",
  "blocks",
  "unknown",
]);

export const CmsFieldSnapshotSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  parentPath: NonEmptyStringSchema.optional(),
  kind: CmsFieldKindSchema,
  cardinality: z.enum(["one", "many"]),
  required: z.boolean(),
  localized: z.boolean(),
  referenceTypes: z.array(NonEmptyStringSchema),
  graphqlField: NonEmptyStringSchema,
});

export const CmsSchemaSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.enum(["contentful", "contentstack"]),
  contentType: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  graphqlType: NonEmptyStringSchema,
  capturedAt: IsoDateTimeSchema,
  digest: FingerprintSchema,
  fields: z.array(CmsFieldSnapshotSchema).min(1),
  schemaArtifact: ArtifactRefSchema,
  sampleEntryArtifact: ArtifactRefSchema.optional(),
});

export const PlannedFieldBindingSchema = FieldBindingSchema.extend({
  sourceKind: CmsFieldKindSchema,
  renderHint: z.enum(["text", "rich-text", "image", "link", "collection", "structured-data"]),
});

export const FieldBindingPlanSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  cmsType: NonEmptyStringSchema,
  bindings: z.array(PlannedFieldBindingSchema).min(1),
  uncoveredFields: z.array(NonEmptyStringSchema),
  digest: FingerprintSchema,
  artifact: ArtifactRefSchema,
});

export const PlanIssueSchema = z.object({
  code: NonEmptyStringSchema,
  severity: z.enum(["warning", "review-required"]),
  message: NonEmptyStringSchema,
});

export const ComponentPlanSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  status: z.enum(["ready", "review-required"]),
  componentPath: RelativeProjectPathSchema,
  typesPath: RelativeProjectPathSchema,
  transformPath: RelativeProjectPathSchema,
  fragmentPath: RelativeProjectPathSchema,
  manifestPath: RelativeProjectPathSchema,
  fragmentName: NonEmptyStringSchema,
  registryKey: NonEmptyStringSchema,
  allowedFiles: z.array(RelativeProjectPathSchema).min(1),
  reusableComponents: z.array(RelativeProjectPathSchema),
  matchedColorTokens: z.array(NonEmptyStringSchema),
  matchedTypographyTokens: z.array(NonEmptyStringSchema),
  responsiveStrategy: z.array(NonEmptyStringSchema).min(1),
  issues: z.array(PlanIssueSchema),
  digest: FingerprintSchema,
  artifact: ArtifactRefSchema,
});

export const PreparedComponentInputSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: ComponentIdSchema,
  design: DesignSnapshotSchema,
  cms: CmsSchemaSnapshotSchema,
  bindings: FieldBindingPlanSchema,
  plan: ComponentPlanSchema,
  artifacts: z.array(ArtifactRefSchema).min(4),
});

export const InputPreparationPolicySchema = z.object({
  enabled: z.boolean().default(false),
  outputRoot: NonEmptyStringSchema.optional(),
  fetchSampleEntry: z.boolean().default(true),
  failOnReview: z.boolean().default(true),
  requestTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(5 * 60_000)
    .default(60_000),
  figmaTokenEnv:
    NonEmptyStringSchema.regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("FIGMA_ACCESS_TOKEN"),
});

export const PreparedComponentInputsSchema = z.record(
  ComponentIdSchema,
  PreparedComponentInputSchema,
);

export type DesignColorObservation = z.infer<typeof DesignColorObservationSchema>;
export type TypographyObservation = z.infer<typeof TypographyObservationSchema>;
export type SpacingObservation = z.infer<typeof SpacingObservationSchema>;
export type DesignComponentInstance = z.infer<typeof DesignComponentInstanceSchema>;
export type DesignAssetObservation = z.infer<typeof DesignAssetObservationSchema>;
export type DesignFrameSnapshot = z.infer<typeof DesignFrameSnapshotSchema>;
export type DesignSnapshot = z.infer<typeof DesignSnapshotSchema>;
export type CmsFieldKind = z.infer<typeof CmsFieldKindSchema>;
export type CmsFieldSnapshot = z.infer<typeof CmsFieldSnapshotSchema>;
export type CmsSchemaSnapshot = z.infer<typeof CmsSchemaSnapshotSchema>;
export type PlannedFieldBinding = z.infer<typeof PlannedFieldBindingSchema>;
export type FieldBindingPlan = z.infer<typeof FieldBindingPlanSchema>;
export type PlanIssue = z.infer<typeof PlanIssueSchema>;
export type ComponentPlan = z.infer<typeof ComponentPlanSchema>;
export type PreparedComponentInput = z.infer<typeof PreparedComponentInputSchema>;
export type InputPreparationPolicy = z.infer<typeof InputPreparationPolicySchema>;
export type PreparedComponentInputs = z.infer<typeof PreparedComponentInputsSchema>;
