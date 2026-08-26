import { z } from "zod";
import {
  FingerprintSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RelativeProjectPathSchema,
  ShaSchema,
} from "./shared.js";

export const PackageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun"]);
export const NextRouterSchema = z.enum(["app", "pages"]);

export const ProjectCommandSchema = z.object({
  executable: NonEmptyStringSchema,
  args: z.array(z.string()).default([]),
});

export const ProjectProfileSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  rootDir: NonEmptyStringSchema,
  inspectedCommit: ShaSchema,
  framework: z.object({
    kind: z.literal("nextjs"),
    version: NonEmptyStringSchema.optional(),
    router: NextRouterSchema,
    appDir: RelativeProjectPathSchema,
  }),
  packageManager: PackageManagerSchema,
  commands: z.object({
    install: ProjectCommandSchema,
    build: ProjectCommandSchema,
    typecheck: ProjectCommandSchema.optional(),
    lint: ProjectCommandSchema.optional(),
    test: ProjectCommandSchema.optional(),
    dev: ProjectCommandSchema,
  }),
  paths: z.object({
    sectionRoot: RelativeProjectPathSchema,
    registry: RelativeProjectPathSchema.optional(),
    pageQuery: RelativeProjectPathSchema.optional(),
    graphqlFragments: RelativeProjectPathSchema.optional(),
  }),
  cms: z.enum(["contentful", "contentstack"]).optional(),
});

export const DesignTokenSchema = z.object({
  name: NonEmptyStringSchema,
  value: NonEmptyStringSchema,
  sourcePath: RelativeProjectPathSchema,
});

export const TypographyTokenSchema = z.object({
  name: NonEmptyStringSchema,
  className: NonEmptyStringSchema.optional(),
  fontFamily: NonEmptyStringSchema,
  fontSize: NonEmptyStringSchema,
  lineHeight: NonEmptyStringSchema,
  fontWeight: z.number().int().min(1).max(1000),
  sourcePath: RelativeProjectPathSchema,
});

export const StyleGuideProfileSchema = z.object({
  source: z.enum(["existing", "generated"]),
  files: z.array(RelativeProjectPathSchema).min(1),
  colors: z.array(DesignTokenSchema),
  spacing: z.array(DesignTokenSchema),
  typography: z.array(TypographyTokenSchema),
  breakpoints: z.record(NonEmptyStringSchema, z.number().int().nonnegative()),
  primitives: z.array(
    z.object({
      name: NonEmptyStringSchema,
      path: RelativeProjectPathSchema,
      kind: z.enum(["button", "link", "icon", "other"]),
    }),
  ),
});

export const PaddingSchema = z.object({
  top: z.number().nonnegative(),
  right: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
});

export const ContainerProfileSchema = z.object({
  source: z.enum(["existing", "generated"]),
  componentPath: RelativeProjectPathSchema,
  importPath: NonEmptyStringSchema,
  desktopMaxWidth: z.union([z.number().positive(), z.literal("fluid")]),
  mobileMaxWidth: z.union([z.number().positive(), z.literal("fluid")]),
  paddingByBreakpoint: z.record(NonEmptyStringSchema, PaddingSchema),
  supportsFullBleed: z.boolean(),
  supportedProps: z.array(NonEmptyStringSchema),
});

const FoundationCoreSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  reasons: z.array(NonEmptyStringSchema).default([]),
});

export const ReadyProjectFoundationSchema = FoundationCoreSchema.extend({
  status: z.literal("ready"),
  sourceCommit: ShaSchema,
  fingerprint: FingerprintSchema,
  styleGuide: StyleGuideProfileSchema,
  container: ContainerProfileSchema,
});

const MissingFoundationSchema = FoundationCoreSchema.extend({
  status: z.literal("missing"),
  styleGuide: StyleGuideProfileSchema.optional(),
  container: ContainerProfileSchema.optional(),
});

const StaleFoundationSchema = FoundationCoreSchema.extend({
  status: z.literal("stale"),
  sourceCommit: ShaSchema,
  previousFingerprint: FingerprintSchema,
  styleGuide: StyleGuideProfileSchema,
  container: ContainerProfileSchema,
});

export const ProjectFoundationSchema = z.discriminatedUnion("status", [
  ReadyProjectFoundationSchema,
  MissingFoundationSchema,
  StaleFoundationSchema,
]);

export type ProjectCommand = z.infer<typeof ProjectCommandSchema>;
export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
export type DesignToken = z.infer<typeof DesignTokenSchema>;
export type TypographyToken = z.infer<typeof TypographyTokenSchema>;
export type Padding = z.infer<typeof PaddingSchema>;
export type StyleGuideProfile = z.infer<typeof StyleGuideProfileSchema>;
export type ContainerProfile = z.infer<typeof ContainerProfileSchema>;
export type ProjectFoundation = z.infer<typeof ProjectFoundationSchema>;
export type ReadyProjectFoundation = z.infer<typeof ReadyProjectFoundationSchema>;
