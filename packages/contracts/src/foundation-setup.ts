import { z } from "zod";
import { PaddingSchema } from "./project.js";
import {
  NonEmptyStringSchema,
  ProjectIdSchema,
  RelativeProjectPathSchema,
  ShaSchema,
} from "./shared.js";

const TokenNameSchema = NonEmptyStringSchema.regex(
  /^[a-z][a-z0-9-]*$/,
  "Token names must be kebab-case",
);
const CssValueSchema = NonEmptyStringSchema.refine(
  (value) => !/[;{}\r\n]/.test(value),
  "CSS values cannot contain declarations or blocks",
);

export const StyleGuideSetupSpecSchema = z.object({
  tokenFile: RelativeProjectPathSchema.default("styles/foundry/tokens.css"),
  globalCssFile: RelativeProjectPathSchema,
  colors: z.array(z.object({ name: TokenNameSchema, value: CssValueSchema })).min(1),
  spacing: z.array(z.object({ name: TokenNameSchema, value: CssValueSchema })).min(1),
  typography: z
    .array(
      z.object({
        name: TokenNameSchema,
        fontFamily: CssValueSchema,
        fontSize: CssValueSchema,
        lineHeight: CssValueSchema,
        fontWeight: z.number().int().min(1).max(1000),
      }),
    )
    .min(1),
  breakpoints: z.record(TokenNameSchema, z.number().int().positive()),
});

export const ContainerSetupSpecSchema = z.object({
  componentPath: RelativeProjectPathSchema.default("components/ui/Container.tsx"),
  importPath: NonEmptyStringSchema.default("@/components/ui/Container"),
  desktopMaxWidth: z.union([z.number().positive(), z.literal("fluid")]),
  mobileMaxWidth: z.union([z.number().positive(), z.literal("fluid")]),
  paddingByBreakpoint: z.record(TokenNameSchema, PaddingSchema),
  supportsFullBleed: z.boolean().default(true),
});

export const FoundationSetupSpecSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: ProjectIdSchema,
  sourceCommit: ShaSchema,
  styleGuide: StyleGuideSetupSpecSchema,
  container: ContainerSetupSpecSchema,
});

export type StyleGuideSetupSpec = z.infer<typeof StyleGuideSetupSpecSchema>;
export type ContainerSetupSpec = z.infer<typeof ContainerSetupSpecSchema>;
export type FoundationSetupSpec = z.infer<typeof FoundationSetupSpecSchema>;
