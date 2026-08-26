import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FigmaDesignIngestor, parseFigmaFrameUrl } from "../src/index.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

function figmaFetch(input: URL | RequestInfo): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname === "images.test") {
    return Promise.resolve(
      new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }),
    );
  }
  if (url.pathname.endsWith("/images") && url.pathname.includes("/files/")) {
    return Promise.resolve(
      Response.json({ meta: { images: { photo: "https://images.test/photo.png" } } }),
    );
  }
  const nodeId = url.searchParams.get("ids") ?? "1:1";
  if (url.pathname.includes("/nodes")) {
    const desktop = nodeId.endsWith(":1");
    return Promise.resolve(
      Response.json({
        nodes: {
          [nodeId]: {
            document: {
              id: nodeId,
              name: desktop ? "Desktop" : "Mobile",
              type: "FRAME",
              layoutMode: "VERTICAL",
              itemSpacing: 24,
              absoluteBoundingBox: { width: desktop ? 1440 : 390, height: 800 },
              children: [
                {
                  id: `${nodeId}:text`,
                  name: "Heading",
                  type: "TEXT",
                  fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
                  style: { fontFamily: "Inter", fontSize: 48, fontWeight: 700, lineHeightPx: 56 },
                },
                {
                  id: `${nodeId}:image`,
                  name: "Photo",
                  type: "RECTANGLE",
                  fills: [{ type: "IMAGE", imageRef: "photo" }],
                },
              ],
            },
          },
        },
      }),
    );
  }
  if (url.pathname.includes("/images/")) {
    return Promise.resolve(
      Response.json({
        images: { [nodeId]: `https://images.test/${encodeURIComponent(nodeId)}.png` },
      }),
    );
  }
  throw new Error(`Unexpected URL ${url}`);
}

describe("Figma design ingestion", () => {
  it("normalizes frame URLs, observations, screenshots, and image fills", async () => {
    expect(parseFigmaFrameUrl("https://www.figma.com/design/file/Name?node-id=1-2").nodeId).toBe(
      "1:2",
    );
    const outputRoot = await mkdtemp(join(tmpdir(), "foundry-design-"));
    directories.push(outputRoot);
    const ingestor = new FigmaDesignIngestor({
      token: "test-token",
      outputRoot,
      timeoutMs: 10_000,
      fetch: figmaFetch as typeof globalThis.fetch,
    });
    const result = await ingestor.ingest({
      schemaVersion: 1,
      runId: "run-1",
      componentId: "hero",
      projectId: "project-1",
      baseCommit: "a".repeat(40),
      foundationFingerprint: "b".repeat(64),
      name: "Hero",
      slug: "hero",
      design: {
        desktopFrameUrl: "https://www.figma.com/design/file/Name?node-id=1-1",
        mobileFrameUrl: "https://www.figma.com/design/file/Name?node-id=1-2",
      },
      cms: {
        provider: "contentful",
        contentType: "hero",
        variantField: "variant",
        variantValue: "hero",
      },
      agent: { provider: "codex", maxRepairTurns: 1 },
    });
    expect(result.snapshot.desktop.width).toBe(1440);
    expect(result.snapshot.mobile.width).toBe(390);
    expect(result.snapshot.desktop.colors).toContainEqual({ value: "#FF0000", occurrences: 1 });
    expect(result.snapshot.desktop.typography[0]).toMatchObject({
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: 700,
    });
    expect(result.snapshot.desktop.assets[0]?.artifact?.mediaType).toBe("image/png");
    expect(result.snapshotArtifact.path).toContain("design-snapshot");
  });
});
