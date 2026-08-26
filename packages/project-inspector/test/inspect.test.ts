import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inspectNextProject } from "../src/index.js";

const fixtureRoot = fileURLToPath(new URL("../../../fixtures/next-app-ready", import.meta.url));
const commit = "a".repeat(40);

describe("Next.js project inspection", () => {
  it("profiles a supported App Router project with evidence", async () => {
    const inspection = await inspectNextProject({
      rootDir: fixtureRoot,
      projectId: "fixture-ready",
      commitOverride: commit,
    });

    expect(inspection.status).toBe("supported");
    if (inspection.status !== "supported") return;
    expect(inspection.profile.framework).toMatchObject({ router: "app", appDir: "src/app" });
    expect(inspection.profile.packageManager).toBe("pnpm");
    expect(inspection.profile.commands.install).toEqual({
      executable: "pnpm",
      args: ["install", "--frozen-lockfile"],
    });
    expect(inspection.profile.paths).toMatchObject({
      sectionRoot: "src/components/sections",
      registry: "src/components/sections/registry.tsx",
      pageQuery: "src/lib/graphql/queries/page.ts",
      graphqlFragments: "src/lib/graphql/fragments",
    });
    expect(inspection.profile.cms).toBe("contentful");
    expect(inspection.evidence.map(({ kind }) => kind)).toContain("router");
  });

  it("rejects a Next.js project without required scripts", async () => {
    const rootDir = await mkdtemp(resolve(tmpdir(), "foundry-inspection-"));
    await writeFile(
      resolve(rootDir, "package.json"),
      JSON.stringify({ dependencies: { next: "16.0.0" }, scripts: { dev: "next dev" } }),
    );

    const inspection = await inspectNextProject({
      rootDir,
      projectId: "invalid",
      commitOverride: commit,
    });

    expect(inspection.status).toBe("unsupported");
    expect(inspection.diagnostics.map(({ code }) => code)).toContain("BUILD_SCRIPT_MISSING");
    expect(inspection.diagnostics.map(({ code }) => code)).toContain("NEXTJS_ROUTER_MISSING");
  });
});
