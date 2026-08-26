import type { ContainerProfile, Padding, ProjectProfile } from "@foundry/contracts";
import ts from "typescript";
import { z } from "zod";
import { fileExists, readProjectFile } from "./files.js";

const PaddingConfigSchema = z.object({
  top: z.number().nonnegative(),
  right: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
});

const ContainerConfigSchema = z.object({
  desktopMaxWidth: z.union([z.number().positive(), z.literal("fluid")]),
  mobileMaxWidth: z.union([z.number().positive(), z.literal("fluid")]),
  paddingByBreakpoint: z.record(z.string().min(1), PaddingConfigSchema),
  supportsFullBleed: z.boolean(),
  supportedProps: z.array(z.string().min(1)),
});

export interface ContainerDetection {
  profile?: ContainerProfile;
  reasons: string[];
  path?: string;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function literalValue(expressionInput: ts.Expression): unknown {
  const expression = unwrapExpression(expressionInput);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.map(literalValue);
  if (ts.isObjectLiteralExpression(expression)) {
    const value: Record<string, unknown> = {};
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : undefined;
      if (name) value[name] = literalValue(property.initializer);
    }
    return value;
  }
  return undefined;
}

function metadataConfig(
  source: string,
  path: string,
): z.infer<typeof ContainerConfigSchema> | undefined {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== "FOUNDRY_CONTAINER_CONFIG"
      )
        continue;
      if (!declaration.initializer) return undefined;
      const result = ContainerConfigSchema.safeParse(literalValue(declaration.initializer));
      return result.success ? result.data : undefined;
    }
  }
  return undefined;
}

function tailwindPixels(token: string): number | undefined {
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token)?.[1];
  if (arbitrary) return Number(arbitrary);
  const scale = Number(token);
  return Number.isFinite(scale) ? scale * 4 : undefined;
}

function paddingFromSource(source: string): Record<string, Padding> {
  const padding: Record<string, Padding> = {};
  const tokens =
    source.match(/(?:[a-z]+:)*(?:p|px|py|pt|pr|pb|pl)-(?:\[[^\]]+\]|\d+(?:\.\d+)?)/g) ?? [];
  for (const fullToken of tokens) {
    const parts = fullToken.split(":");
    const utility = parts.pop();
    if (!utility) continue;
    const breakpoint = parts.at(-1) ?? "base";
    const match = /^(p|px|py|pt|pr|pb|pl)-(.+)$/.exec(utility);
    if (!match) continue;
    const [, axis, raw] = match;
    if (!axis || !raw) continue;
    const value = tailwindPixels(raw);
    if (value === undefined) continue;
    const current = padding[breakpoint] ?? { top: 0, right: 0, bottom: 0, left: 0 };
    if (axis === "p" || axis === "px" || axis === "pr") current.right = value;
    if (axis === "p" || axis === "px" || axis === "pl") current.left = value;
    if (axis === "p" || axis === "py" || axis === "pt") current.top = value;
    if (axis === "p" || axis === "py" || axis === "pb") current.bottom = value;
    padding[breakpoint] = current;
  }
  return padding;
}

function heuristicConfig(source: string): z.infer<typeof ContainerConfigSchema> | undefined {
  const maxWidth = /max-w-\[(\d+(?:\.\d+)?)px\]/.exec(source)?.[1];
  const fluid = /max-w-(?:full|none)/.test(source);
  const desktopMaxWidth = maxWidth ? Number(maxWidth) : fluid ? "fluid" : undefined;
  const paddingByBreakpoint = paddingFromSource(source);
  if (desktopMaxWidth === undefined || Object.keys(paddingByBreakpoint).length === 0)
    return undefined;
  return {
    desktopMaxWidth,
    mobileMaxWidth: "fluid",
    paddingByBreakpoint,
    supportsFullBleed: /fullBleed|full-bleed|w-screen/.test(source),
    supportedProps: ["children", "className"],
  };
}

function importPathFor(componentPath: string): string {
  const withoutSourceRoot = componentPath.replace(/^src\//, "");
  return `@/${withoutSourceRoot.replace(/\/index\.tsx$/, "").replace(/\.tsx$/, "")}`;
}

export async function detectContainer(profile: ProjectProfile): Promise<ContainerDetection> {
  const candidates = [
    "src/components/ui/Container.tsx",
    "components/ui/Container.tsx",
    "src/components/Container.tsx",
    "components/Container.tsx",
  ];
  const componentPath = (
    await Promise.all(
      candidates.map(async (path) => ({
        path,
        exists: await fileExists(`${profile.rootDir}/${path}`),
      })),
    )
  ).find(({ exists }) => exists)?.path;
  if (!componentPath) return { reasons: ["No Container component was found"] };

  const source = await readProjectFile(profile.rootDir, componentPath);
  const metadata = metadataConfig(source, componentPath);
  const config = metadata ?? heuristicConfig(source);
  if (!config) {
    return {
      path: componentPath,
      reasons: [
        `${componentPath} exists, but its max width and breakpoint padding could not be resolved`,
      ],
    };
  }

  return {
    path: componentPath,
    reasons: [],
    profile: {
      source: metadata ? "generated" : "existing",
      componentPath,
      importPath: importPathFor(componentPath),
      ...config,
    },
  };
}
