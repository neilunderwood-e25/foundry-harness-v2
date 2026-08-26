import { appendFile, cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FoundationSetupSpec, ProjectProfile } from "@foundry/contracts";
import { inspectNextProject } from "@foundry/project-inspector";
import { describe, expect, it } from "vitest";
import { inspectProjectFoundation, setupProjectFoundation } from "../src/index.js";

const readyFixture = fileURLToPath(new URL("../../../fixtures/next-app-ready", import.meta.url));
const missingFixture = fileURLToPath(
  new URL("../../../fixtures/next-app-missing-foundation", import.meta.url),
);
const commit = "a".repeat(40);

async function profile(rootDir: string, projectId = "fixture"): Promise<ProjectProfile> {
  const inspection = await inspectNextProject({ rootDir, projectId, commitOverride: commit });
  if (inspection.status !== "supported") {
    throw new Error(inspection.diagnostics.map(({ message }) => message).join("; "));
  }
  return inspection.profile;
}

describe("project foundation detection", () => {
  it("freezes a detected Style Guide and Container", async () => {
    const foundation = await inspectProjectFoundation(await profile(readyFixture));
    expect(foundation.status).toBe("ready");
    if (foundation.status !== "ready") return;
    expect(foundation.styleGuide.source).toBe("existing");
    expect(foundation.styleGuide.colors.map(({ name }) => name)).toContain("color-primary");
    expect(foundation.styleGuide.typography.map(({ name }) => name)).toContain("type-heading-xl");
    expect(foundation.container).toMatchObject({
      source: "existing",
      desktopMaxWidth: 1440,
      mobileMaxWidth: "fluid",
      supportsFullBleed: true,
    });
    expect(foundation.container.paddingByBreakpoint["base"]?.left).toBe(16);
    expect(foundation.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports missing foundation requirements", async () => {
    const foundation = await inspectProjectFoundation(await profile(missingFixture));
    expect(foundation.status).toBe("missing");
    expect(foundation.reasons).toContain("No named color tokens were detected");
    expect(foundation.reasons).toContain("No Container component was found");
  });

  it("marks a changed frozen foundation stale", async () => {
    const rootDir = await mkdtemp(resolve(tmpdir(), "foundry-foundation-stale-"));
    await cp(readyFixture, rootDir, { recursive: true });
    const project = await profile(rootDir);
    const first = await inspectProjectFoundation(project);
    expect(first.status).toBe("ready");
    await appendFile(resolve(rootDir, "src/styles/tokens.css"), "\n/* changed */\n");
    const second = await inspectProjectFoundation(project, { previous: first });
    expect(second.status).toBe("stale");
  });
});

describe("project foundation setup", () => {
  it("generates and verifies an explicit Style Guide and Container", async () => {
    const rootDir = await mkdtemp(resolve(tmpdir(), "foundry-foundation-setup-"));
    await cp(missingFixture, rootDir, { recursive: true });
    const project = await profile(rootDir, "generated-foundation");
    const specification: FoundationSetupSpec = {
      schemaVersion: 1,
      projectId: project.projectId,
      sourceCommit: project.inspectedCommit,
      styleGuide: {
        tokenFile: "styles/foundry/tokens.css",
        globalCssFile: "app/globals.css",
        colors: [
          { name: "primary", value: "#112233" },
          { name: "surface", value: "#ffffff" },
        ],
        spacing: [
          { name: "gutter", value: "1rem" },
          { name: "section", value: "5rem" },
        ],
        typography: [
          {
            name: "heading-xl",
            fontFamily: '"Inter", sans-serif',
            fontSize: "4rem",
            lineHeight: "1.05",
            fontWeight: 700,
          },
        ],
        breakpoints: { md: 768, xl: 1280 },
      },
      container: {
        componentPath: "components/ui/Container.tsx",
        importPath: "@/components/ui/Container",
        desktopMaxWidth: 1440,
        mobileMaxWidth: "fluid",
        paddingByBreakpoint: {
          base: { top: 0, right: 16, bottom: 0, left: 16 },
          md: { top: 0, right: 32, bottom: 0, left: 32 },
          xl: { top: 0, right: 80, bottom: 0, left: 80 },
        },
        supportsFullBleed: true,
      },
    };

    const foundation = await setupProjectFoundation(project, specification);
    expect(foundation.status).toBe("ready");
    expect(foundation.styleGuide.source).toBe("generated");
    expect(foundation.container.source).toBe("generated");
    expect(await readFile(resolve(rootDir, "app/globals.css"), "utf8")).toContain(
      '@import "../styles/foundry/tokens.css";',
    );
    await expect(setupProjectFoundation(project, specification)).rejects.toThrow(/overwrite/i);
  });
});
