import type {
  DesignToken,
  ProjectProfile,
  StyleGuideProfile,
  TypographyToken,
} from "@foundry/contracts";
import postcss, { type Declaration, type Rule } from "postcss";
import { collectFiles, fileExists, readProjectFile } from "./files.js";

export interface StyleGuideDetection {
  profile?: StyleGuideProfile;
  reasons: string[];
  files: string[];
}

const COLOR_VALUE = /^(?:#|rgb|hsl|oklch|lab|lch|color\()/i;
const COLOR_NAME = /color|background|foreground|border|accent|primary|secondary|surface|text/i;
const SPACING_NAME = /space|spacing|gap|padding|margin|gutter/i;

function uniqueTokens(tokens: DesignToken[]): DesignToken[] {
  return [
    ...new Map(tokens.map((token) => [`${token.name}:${token.sourcePath}`, token])).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

function declarationMap(rule: Rule): Map<string, Declaration> {
  const declarations = new Map<string, Declaration>();
  rule.walkDecls((declaration) => {
    declarations.set(declaration.prop, declaration);
  });
  return declarations;
}

function typographyFromRule(rule: Rule, sourcePath: string): TypographyToken | undefined {
  const className = /^\.([a-zA-Z0-9_-]+)$/.exec(rule.selector.trim())?.[1];
  if (!className) return undefined;
  const declarations = declarationMap(rule);
  const fontFamily = declarations.get("font-family")?.value;
  const fontSize = declarations.get("font-size")?.value;
  const lineHeight = declarations.get("line-height")?.value;
  const weight = Number(declarations.get("font-weight")?.value);
  if (!fontFamily || !fontSize || !lineHeight || !Number.isFinite(weight)) return undefined;
  return {
    name: className,
    className,
    fontFamily,
    fontSize,
    lineHeight,
    fontWeight: weight,
    sourcePath,
  };
}

async function primitiveFiles(profile: ProjectProfile): Promise<StyleGuideProfile["primitives"]> {
  const candidates = await collectFiles(
    profile.rootDir,
    ["components/ui", "src/components/ui"],
    new Set([".ts", ".tsx"]),
    100,
  );
  return candidates
    .map((path) => {
      const filename =
        path
          .split("/")
          .at(-1)
          ?.replace(/\.[^.]+$/, "") ?? "component";
      const normalized = filename.toLowerCase();
      const kind = normalized.includes("button")
        ? ("button" as const)
        : normalized.includes("link")
          ? ("link" as const)
          : normalized.includes("icon")
            ? ("icon" as const)
            : ("other" as const);
      return { name: filename, path, kind };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function detectStyleGuide(profile: ProjectProfile): Promise<StyleGuideDetection> {
  const directCandidates = [
    `${profile.framework.appDir}/globals.css`,
    "styles/globals.css",
    "src/styles/globals.css",
  ];
  const direct = [];
  for (const path of directCandidates) {
    if (await fileExists(`${profile.rootDir}/${path}`)) direct.push(path);
  }
  const discovered = await collectFiles(
    profile.rootDir,
    ["styles", "src/styles"],
    new Set([".css"]),
  );
  const files = [...new Set([...direct, ...discovered])].sort();
  const colors: DesignToken[] = [];
  const spacing: DesignToken[] = [];
  const typography: TypographyToken[] = [];
  const breakpoints: Record<string, number> = {};
  const reasons: string[] = [];

  for (const path of files) {
    let root;
    try {
      root = postcss.parse(await readProjectFile(profile.rootDir, path), { from: path });
    } catch (error) {
      reasons.push(
        `${path} could not be parsed: ${error instanceof Error ? error.message : "unknown CSS error"}`,
      );
      continue;
    }
    root.walkDecls((declaration) => {
      if (!declaration.prop.startsWith("--")) return;
      const name = declaration.prop.slice(2);
      const token = { name, value: declaration.value.trim(), sourcePath: path };
      if (COLOR_NAME.test(name) || COLOR_VALUE.test(declaration.value.trim())) colors.push(token);
      if (SPACING_NAME.test(name)) spacing.push(token);
      const breakpointName = /^breakpoint-(.+)$/.exec(name)?.[1];
      const breakpointValue = /^(\d+(?:\.\d+)?)px$/.exec(declaration.value.trim())?.[1];
      if (breakpointName && breakpointValue) breakpoints[breakpointName] = Number(breakpointValue);
    });
    root.walkAtRules("media", (rule) => {
      const width = /min-width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(rule.params)?.[1];
      if (width) breakpoints[`width-${width}`] = Number(width);
    });
    root.walkRules((rule) => {
      const token = typographyFromRule(rule, path);
      if (token) typography.push(token);
    });
  }

  const uniqueColors = uniqueTokens(colors);
  const uniqueSpacing = uniqueTokens(spacing);
  const uniqueTypography = [
    ...new Map(typography.map((token) => [`${token.name}:${token.sourcePath}`, token])).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));

  if (files.length === 0) reasons.push("No project CSS files were found");
  if (uniqueColors.length === 0) reasons.push("No named color tokens were detected");
  if (uniqueSpacing.length === 0) reasons.push("No named spacing tokens were detected");
  if (uniqueTypography.length === 0) reasons.push("No complete typography utilities were detected");
  if (Object.keys(breakpoints).length === 0) reasons.push("No pixel breakpoints were detected");

  if (reasons.length > 0) return { reasons, files };
  return {
    reasons,
    files,
    profile: {
      source: files.some((path) => path.includes("styles/foundry/")) ? "generated" : "existing",
      files,
      colors: uniqueColors,
      spacing: uniqueSpacing,
      typography: uniqueTypography,
      breakpoints,
      primitives: await primitiveFiles(profile),
    },
  };
}
