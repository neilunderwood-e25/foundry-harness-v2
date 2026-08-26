import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  BatchDeliveryRequestSchema,
  type BatchDeliveryRequest,
  type WorktreeHandle,
} from "@foundry/contracts";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import {
  FigmaRestReferenceProvider,
  PngImageComparator,
  VisualAccessibilityVerifier,
  type BrowserInspector,
  type DesignReferenceProvider,
  type ImageComparator,
  type PreviewServer,
} from "../src/index.js";

const roots: string[] = [];
const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

afterEach(async () => {
  delete process.env["FOUNDRY_TEST_FIGMA_TOKEN"];
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function png(width: number, height: number, red: number): Buffer {
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = 20;
    image.data[index + 2] = 30;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

function request(root: string): BatchDeliveryRequest {
  const component = (slug: string) => ({
    schemaVersion: 1 as const,
    runId: "quality-run",
    componentId: slug,
    projectId: "project-1",
    baseCommit: sha,
    foundationFingerprint: fingerprint,
    name: slug,
    slug,
    design: {
      desktopFrameUrl: "https://figma.com/design/file-key/Foundry?node-id=1-2",
      mobileFrameUrl: "https://figma.com/design/file-key/Foundry?node-id=3-4",
    },
    cms: {
      provider: "contentful" as const,
      contentType: `${slug}Section`,
      variantField: "frontendComponent",
      variantValue: slug,
    },
    agent: { provider: "codex" as const },
  });
  return BatchDeliveryRequestSchema.parse({
    schemaVersion: 1,
    project: {
      schemaVersion: 1,
      projectId: "project-1",
      rootDir: root,
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
        colors: [],
        spacing: [],
        typography: [],
        breakpoints: {},
        primitives: [],
      },
      container: {
        source: "existing",
        componentPath: "src/components/ui/Container.tsx",
        importPath: "@/components/ui/Container",
        desktopMaxWidth: "fluid",
        mobileMaxWidth: "fluid",
        paddingByBreakpoint: {},
        supportsFullBleed: false,
        supportedProps: ["children"],
      },
    },
    batch: {
      schemaVersion: 1,
      runId: "quality-run",
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: [component("hero"), component("cards")],
    },
    worktreeRoot: resolve(root, "worktrees"),
    quality: {
      enabled: true,
      routeTemplate: "/qa/{slug}",
      selectorTemplate: '[data-foundry="{slug}"]',
      maxDiffRatio: 0.03,
      pixelThreshold: 0.1,
      runAccessibility: true,
      minimumAccessibilityImpact: "serious",
      startupTimeoutMs: 10_000,
      navigationTimeoutMs: 10_000,
      figmaTokenEnv: "FOUNDRY_TEST_FIGMA_TOKEN",
    },
  });
}

describe("Figma references", () => {
  it("exports both frame URLs through the REST adapter and caches PNG dimensions", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "foundry-figma-reference-"));
    roots.push(root);
    process.env["FOUNDRY_TEST_FIGMA_TOKEN"] = "test-token";
    const requested: string[] = [];
    const image = png(4, 3, 100);
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.startsWith("https://api.figma.com/v1/images/")) {
        const node = new URL(url).searchParams.get("ids")!;
        return new Response(JSON.stringify({ images: { [node]: `https://images.test/${node}` } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(image, { status: 200, headers: { "content-type": "image/png" } });
    };
    const specification = request(root).batch.components[0]!;
    const provider = new FigmaRestReferenceProvider({ fetch: fetchMock });
    const first = await provider.exportReferences({
      specification,
      outputDirectory: root,
      tokenEnvironmentVariable: "FOUNDRY_TEST_FIGMA_TOKEN",
      timeoutMs: 10_000,
    });
    const second = await provider.exportReferences({
      specification,
      outputDirectory: root,
      tokenEnvironmentVariable: "FOUNDRY_TEST_FIGMA_TOKEN",
      timeoutMs: 10_000,
    });

    expect(first.map(({ label, width, height }) => ({ label, width, height }))).toEqual([
      { label: "desktop", width: 4, height: 3 },
      { label: "mobile", width: 4, height: 3 },
    ]);
    expect(second).toEqual(first);
    expect(requested.filter((url) => url.startsWith("https://api.figma.com"))).toHaveLength(2);
    expect(requested.some((url) => url.includes("ids=1%3A2"))).toBe(true);
  });
});

describe("PNG comparison", () => {
  it("writes a visual diff and reports the differing-pixel ratio", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "foundry-image-comparison-"));
    roots.push(root);
    const reference = resolve(root, "reference.png");
    const actual = resolve(root, "actual.png");
    const diff = resolve(root, "diff.png");
    await writeFile(reference, png(2, 2, 10));
    await writeFile(actual, png(2, 2, 240));
    const result = await new PngImageComparator().compare({
      referencePath: reference,
      actualPath: actual,
      diffPath: diff,
      pixelThreshold: 0.1,
    });

    expect(result.ratio).toBe(1);
    expect(result.differingPixels).toBe(4);
    expect((await stat(diff)).isFile()).toBe(true);
  });

  it("counts rendered pixels outside the Figma frame as differences", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "foundry-image-bounds-"));
    roots.push(root);
    const reference = resolve(root, "reference.png");
    const actual = resolve(root, "actual.png");
    await writeFile(reference, png(1, 1, 10));
    await writeFile(actual, png(2, 1, 10));
    const result = await new PngImageComparator().compare({
      referencePath: reference,
      actualPath: actual,
      diffPath: resolve(root, "diff.png"),
      pixelThreshold: 0.1,
    });

    expect(result.ratio).toBe(0.5);
  });
});

describe("visual and accessibility gates", () => {
  it("produces repairable breakpoint, reflow, and accessibility diagnostics with artifacts", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "foundry-quality-gates-"));
    roots.push(root);
    const references: DesignReferenceProvider = {
      async exportReferences(input) {
        await mkdir(input.outputDirectory, { recursive: true });
        return [
          {
            label: "desktop",
            sourceUrl: input.specification.design.desktopFrameUrl,
            path: resolve(input.outputDirectory, "desktop-reference.png"),
            width: 1440,
            height: 700,
          },
          {
            label: "mobile",
            sourceUrl: input.specification.design.mobileFrameUrl,
            path: resolve(input.outputDirectory, "mobile-reference.png"),
            width: 390,
            height: 600,
          },
        ];
      },
    };
    let stopped = false;
    const preview: PreviewServer = {
      async start() {
        return {
          baseUrl: "http://127.0.0.1:9999",
          logs: () => "ready",
          async stop() {
            stopped = true;
          },
        };
      },
    };
    const browser: BrowserInspector = {
      async inspect(input) {
        return {
          captures: input.references.map((reference) => ({
            label: reference.label,
            path: resolve(input.outputDirectory, `${reference.label}-actual.png`),
            width: reference.width,
            height: reference.height,
          })),
          reflow: { ok: false, width: 915, detail: "page overflows by 12px" },
          accessibility: [
            {
              id: "color-contrast",
              impact: "serious",
              help: "Fix contrast",
              nodes: [
                { target: [".title"], failureSummary: "Insufficient contrast" },
                { target: [".caption"] },
              ],
            },
          ],
        };
      },
    };
    const comparator: ImageComparator = {
      async compare(input) {
        const mobile = input.actualPath.includes("mobile");
        return {
          ratio: mobile ? 0.05 : 0.01,
          differingPixels: mobile ? 5 : 1,
          comparedPixels: 100,
          referenceSize: { width: mobile ? 390 : 1440, height: 600 },
          actualSize: { width: mobile ? 390 : 1440, height: 600 },
          diffPath: input.diffPath,
        };
      },
    };
    const delivery = request(root);
    const worktree: WorktreeHandle = {
      jobId: "quality-run:hero" as WorktreeHandle["jobId"],
      checkoutDir: root,
      workingDirectory: root,
      branch: "foundry/quality-run/hero",
      baseCommit: sha,
    };
    const gates = await new VisualAccessibilityVerifier({
      references,
      preview,
      browser,
      comparator,
    }).verify({
      request: delivery,
      specification: delivery.batch.components[0]!,
      worktree,
      attempt: 1,
    });

    expect(stopped).toBe(true);
    expect(gates.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "visual:desktop", status: "passed" },
      { id: "visual:mobile", status: "failed" },
      { id: "reflow", status: "failed" },
      { id: "accessibility", status: "failed" },
    ]);
    expect(gates.every(({ repairable }) => repairable === true)).toBe(true);
    expect(gates.flatMap(({ artifacts }) => artifacts)).toHaveLength(7);
    const accessibility = gates.find(({ id }) => id === "accessibility")!;
    expect(JSON.parse(await readFile(accessibility.artifacts[0]!.path, "utf8"))).toHaveLength(1);
  });
});
