import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InputArtifactStore, contentDigest } from "../src/index.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

describe("input artifacts", () => {
  it("canonicalizes JSON and writes immutable content-addressed evidence", async () => {
    expect(contentDigest({ b: 2, a: 1 })).toBe(contentDigest({ a: 1, b: 2 }));
    const root = await mkdtemp(join(tmpdir(), "foundry-input-"));
    directories.push(root);
    const store = new InputArtifactStore({ rootDirectory: root });
    const first = await store.writeJson({
      componentId: "hero",
      kind: "design",
      label: "frame",
      value: { a: 1 },
    });
    const second = await store.writeJson({
      componentId: "hero",
      kind: "design",
      label: "frame",
      value: { a: 1 },
    });
    const reordered = await store.writeJson({
      componentId: "hero",
      kind: "design",
      label: "frame",
      value: { b: 2, a: 1 },
    });
    const canonical = await store.writeJson({
      componentId: "hero",
      kind: "design",
      label: "frame",
      value: { a: 1, b: 2 },
    });
    expect(second.path).toBe(first.path);
    expect(reordered.path).toBe(canonical.path);
    expect(JSON.parse(await readFile(first.path, "utf8"))).toEqual({ a: 1 });
  });
});
