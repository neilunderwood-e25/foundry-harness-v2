import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import {
  FoundationSetupSpecSchema,
  type FoundationSetupSpec,
  type ProjectProfile,
  type ReadyProjectFoundation,
} from "@foundry/contracts";
import { absoluteProjectPath, fileExists } from "./files.js";
import { inspectProjectFoundation } from "./inspect.js";

export interface SetupFoundationOptions {
  overwrite?: boolean;
}

function cssImportPath(globalCssPath: string, tokenPath: string): string {
  const rel = relative(dirname(globalCssPath), tokenPath).split(sep).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function paddingDeclarations(padding: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): string[] {
  return [
    `padding-top: ${padding.top}px;`,
    `padding-right: ${padding.right}px;`,
    `padding-bottom: ${padding.bottom}px;`,
    `padding-left: ${padding.left}px;`,
  ];
}

function renderStyleGuide(specification: FoundationSetupSpec): string {
  const { styleGuide, container } = specification;
  const lines = [":root {"];
  for (const token of styleGuide.colors) lines.push(`  --color-${token.name}: ${token.value};`);
  for (const token of styleGuide.spacing) lines.push(`  --spacing-${token.name}: ${token.value};`);
  for (const [name, width] of Object.entries(styleGuide.breakpoints).sort(
    ([, left], [, right]) => left - right,
  )) {
    lines.push(`  --breakpoint-${name}: ${width}px;`);
  }
  lines.push("}", "");

  for (const token of styleGuide.typography) {
    lines.push(
      `.type-${token.name} {`,
      `  font-family: ${token.fontFamily};`,
      `  font-size: ${token.fontSize};`,
      `  line-height: ${token.lineHeight};`,
      `  font-weight: ${token.fontWeight};`,
      "}",
      "",
    );
  }

  const basePadding = container.paddingByBreakpoint["base"] ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  lines.push(
    ".foundry-container {",
    "  box-sizing: border-box;",
    "  width: 100%;",
    "  margin-right: auto;",
    "  margin-left: auto;",
    ...(container.mobileMaxWidth === "fluid"
      ? ["  max-width: none;"]
      : [`  max-width: ${container.mobileMaxWidth}px;`]),
    ...paddingDeclarations(basePadding).map((line) => `  ${line}`),
    "}",
    "",
    ".foundry-container--full-bleed {",
    "  max-width: none;",
    "  padding-right: 0;",
    "  padding-left: 0;",
    "}",
    "",
  );

  const breakpoints = Object.entries(styleGuide.breakpoints).sort(
    ([, left], [, right]) => left - right,
  );
  for (const [name, width] of breakpoints) {
    const padding = container.paddingByBreakpoint[name];
    const isDesktop = width === breakpoints.at(-1)?.[1];
    if (!padding && !isDesktop) continue;
    lines.push(`@media (min-width: ${width}px) {`, "  .foundry-container {");
    if (isDesktop) {
      lines.push(
        ...(container.desktopMaxWidth === "fluid"
          ? ["    max-width: none;"]
          : [`    max-width: ${container.desktopMaxWidth}px;`]),
      );
    }
    if (padding) lines.push(...paddingDeclarations(padding).map((line) => `    ${line}`));
    lines.push("  }", "}", "");
  }

  return `${lines.join("\n").trim()}\n`;
}

function renderContainer(specification: FoundationSetupSpec): string {
  const config = {
    desktopMaxWidth: specification.container.desktopMaxWidth,
    mobileMaxWidth: specification.container.mobileMaxWidth,
    paddingByBreakpoint: specification.container.paddingByBreakpoint,
    supportsFullBleed: specification.container.supportsFullBleed,
    supportedProps: ["children", "className", "fullBleed"],
  };
  return `import type { ReactNode } from "react";

export const FOUNDRY_CONTAINER_CONFIG = ${JSON.stringify(config, null, 2)} as const;

export interface ContainerProps {
  children: ReactNode;
  className?: string;
  fullBleed?: boolean;
}

export function Container({ children, className, fullBleed = false }: ContainerProps) {
  const classes = [
    "foundry-container",
    fullBleed ? "foundry-container--full-bleed" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes}>{children}</div>;
}
`;
}

async function assertWritable(path: string, overwrite: boolean): Promise<void> {
  if (!overwrite && (await fileExists(path))) {
    throw new Error(`Refusing to overwrite existing foundation file: ${path}`);
  }
}

export async function setupProjectFoundation(
  profile: ProjectProfile,
  input: FoundationSetupSpec,
  options: SetupFoundationOptions = {},
): Promise<ReadyProjectFoundation> {
  const specification = FoundationSetupSpecSchema.parse(input);
  if (specification.projectId !== profile.projectId) {
    throw new Error("Foundation setup belongs to another project");
  }
  if (specification.sourceCommit !== profile.inspectedCommit) {
    throw new Error("Foundation setup commit does not match the inspected project commit");
  }

  const tokenPath = absoluteProjectPath(profile.rootDir, specification.styleGuide.tokenFile);
  const globalCssPath = absoluteProjectPath(
    profile.rootDir,
    specification.styleGuide.globalCssFile,
  );
  const containerPath = absoluteProjectPath(profile.rootDir, specification.container.componentPath);
  await Promise.all([
    assertWritable(tokenPath, options.overwrite ?? false),
    assertWritable(containerPath, options.overwrite ?? false),
  ]);

  await Promise.all([
    mkdir(dirname(tokenPath), { recursive: true }),
    mkdir(dirname(globalCssPath), { recursive: true }),
    mkdir(dirname(containerPath), { recursive: true }),
  ]);

  const importPath = cssImportPath(globalCssPath, tokenPath);
  const importStatement = `@import "${importPath}";`;
  const existingGlobalCss = (await fileExists(globalCssPath))
    ? await readFile(globalCssPath, "utf8")
    : "";
  const nextGlobalCss = existingGlobalCss.includes(importStatement)
    ? existingGlobalCss
    : `${importStatement}\n${existingGlobalCss}`;

  await Promise.all([
    writeFile(tokenPath, renderStyleGuide(specification), "utf8"),
    writeFile(globalCssPath, nextGlobalCss, "utf8"),
    writeFile(containerPath, renderContainer(specification), "utf8"),
  ]);

  const foundation = await inspectProjectFoundation(profile, { acceptChanges: true });
  if (foundation.status !== "ready") {
    throw new Error(
      `Generated foundation did not pass inspection: ${foundation.reasons.join("; ")}`,
    );
  }
  return foundation;
}
