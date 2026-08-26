import { CmsAdapterRegistry, type CmsAdapter } from "@foundry/cms-core";
import { BatchDeliveryRequestSchema } from "@foundry/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BatchInputPreparer } from "../src/index.js";

const directories: string[] = [];
let desktopFrameWidth = 1440;
afterEach(async () => {
  desktopFrameWidth = 1440;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});
const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

function request(outputRoot: string, mobileWidth = 390) {
  const component = (slug: string) => ({
    schemaVersion: 1 as const,
    runId: "prepare-1",
    componentId: slug,
    projectId: "project-1",
    baseCommit: sha,
    foundationFingerprint: fingerprint,
    name: slug === "hero" ? "Hero" : "Cards",
    slug,
    design: {
      desktopFrameUrl: `https://figma.com/design/file/Foundry?node-id=${slug}-1`,
      mobileFrameUrl: `https://figma.com/design/file/Foundry?node-id=${slug}-2`,
    },
    cms: {
      provider: "contentful" as const,
      contentType: `${slug}Section`,
      variantField: "frontendComponent",
      variantValue: slug,
    },
    agent: { provider: "codex" as const, maxRepairTurns: 1 },
  });
  return BatchDeliveryRequestSchema.parse({
    schemaVersion: 1,
    project: {
      schemaVersion: 1,
      projectId: "project-1",
      rootDir: "/tmp/project",
      inspectedCommit: sha,
      framework: { kind: "nextjs", router: "app", appDir: "src/app" },
      packageManager: "pnpm",
      commands: {
        install: { executable: "pnpm", args: ["install"] },
        build: { executable: "pnpm", args: ["build"] },
        dev: { executable: "pnpm", args: ["dev"] },
      },
      paths: { sectionRoot: "src/components/sections" },
    },
    foundation: {
      schemaVersion: 1,
      projectId: "project-1",
      status: "ready",
      sourceCommit: sha,
      fingerprint,
      reasons: [],
      styleGuide: {
        source: "existing",
        files: ["src/styles/tokens.css"],
        colors: [{ name: "brand", value: "#FF0000", sourcePath: "src/styles/tokens.css" }],
        spacing: [],
        typography: [
          {
            name: "display",
            fontFamily: "Inter",
            fontSize: "48px",
            lineHeight: "56px",
            fontWeight: 700,
            sourcePath: "src/styles/tokens.css",
          },
        ],
        breakpoints: { md: 768 },
        primitives: [{ name: "Button", path: "src/components/ui/Button.tsx", kind: "button" }],
      },
      container: {
        source: "existing",
        componentPath: "src/components/ui/Container.tsx",
        importPath: "@/components/ui/Container",
        desktopMaxWidth: 1200,
        mobileMaxWidth: "fluid",
        paddingByBreakpoint: {},
        supportsFullBleed: true,
        supportedProps: ["children", "fullBleed"],
      },
    },
    batch: {
      schemaVersion: 1,
      runId: "prepare-1",
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: [component("hero"), component("cards")],
    },
    worktreeRoot: "/tmp/worktrees",
    inputPreparation: {
      enabled: true,
      outputRoot,
      fetchSampleEntry: true,
      failOnReview: true,
      requestTimeoutMs: 10_000,
      figmaTokenEnv: "FIGMA_ACCESS_TOKEN",
    },
    testMobileWidth: mobileWidth,
  });
}

function figmaFetch(input: URL | RequestInfo): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname === "images.test")
    return Promise.resolve(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
    );
  const nodeId = url.searchParams.get("ids") ?? "unknown";
  if (url.pathname.includes("/nodes")) {
    return Promise.resolve(
      Response.json({
        nodes: {
          [nodeId]: {
            document: {
              id: nodeId,
              name: nodeId.endsWith(":1") ? "Desktop" : "Mobile",
              type: "FRAME",
              absoluteBoundingBox: {
                width: nodeId.endsWith(":1") ? desktopFrameWidth : 390,
                height: 800,
              },
              children: [
                {
                  id: `${nodeId}:heading`,
                  name: "Heading",
                  type: "TEXT",
                  fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
                  style: { fontFamily: "Inter", fontSize: 48, fontWeight: 700, lineHeightPx: 56 },
                },
              ],
            },
          },
        },
      }),
    );
  }
  if (url.pathname.includes("/images/"))
    return Promise.resolve(
      Response.json({ images: { [nodeId]: `https://images.test/${nodeId}.png` } }),
    );
  throw new Error(`Unexpected URL ${url}`);
}

const cmsAdapter: CmsAdapter = {
  provider: "contentful",
  async inspect(reference) {
    return {
      provider: "contentful",
      contentType: reference.contentType,
      name: reference.contentType,
      graphqlType: "HeroSection",
      fields: [
        {
          id: "frontendComponent",
          name: "Frontend component",
          path: "frontendComponent",
          kind: "text",
          cardinality: "one",
          required: true,
          localized: false,
          referenceTypes: [],
          graphqlField: "frontendComponent",
        },
        {
          id: "title",
          name: "Title",
          path: "title",
          kind: "text",
          cardinality: "one",
          required: true,
          localized: false,
          referenceTypes: [],
          graphqlField: "title",
        },
      ],
      rawSchema: { name: reference.contentType },
      sampleEntry: { title: "Safe sample" },
    };
  },
};

describe("batch input preparation", () => {
  it("creates deterministic component, binding, CMS, and design evidence before generation", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "foundry-prepare-"));
    directories.push(outputRoot);
    const result = await new BatchInputPreparer({
      cmsAdapters: new CmsAdapterRegistry([cmsAdapter]),
      environment: { FIGMA_ACCESS_TOKEN: "secret" },
      fetch: figmaFetch as typeof globalThis.fetch,
    }).prepare(request(outputRoot));
    expect(Object.keys(result.inputs)).toEqual(["hero", "cards"]);
    expect(result.inputs["hero"]?.plan).toMatchObject({
      status: "ready",
      matchedColorTokens: ["brand"],
      matchedTypographyTokens: ["display"],
      fragmentPath: "src/components/sections/hero/hero.fragment.graphql",
    });
    expect(result.inputs["hero"]?.bindings.bindings.map(({ cmsField }) => cmsField)).toEqual([
      "frontendComponent",
      "title",
    ]);
    expect(result.artifacts.length).toBeGreaterThanOrEqual(12);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("blocks ambiguous responsive inputs before agent work starts", async () => {
    desktopFrameWidth = 320;
    const outputRoot = await mkdtemp(join(tmpdir(), "foundry-review-"));
    directories.push(outputRoot);
    const preparation = new BatchInputPreparer({
      cmsAdapters: new CmsAdapterRegistry([cmsAdapter]),
      environment: { FIGMA_ACCESS_TOKEN: "secret" },
      fetch: figmaFetch as typeof globalThis.fetch,
    });
    await expect(preparation.prepare(request(outputRoot))).rejects.toMatchObject({
      code: "INPUT_REVIEW_REQUIRED",
    });
  });
});
