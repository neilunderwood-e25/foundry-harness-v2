import { ArtifactRefSchema, type ArtifactRef } from "@foundry/contracts";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson, contentDigest } from "./hash.js";

export interface InputArtifactStoreOptions {
  readonly rootDirectory: string;
  readonly clock?: () => Date;
}

function extensionFor(mediaType: string): string {
  switch (mediaType) {
    case "application/json":
      return "json";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/svg+xml":
      return "svg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

function safeSegment(value: string): string {
  const segment = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!segment) throw new Error("Artifact path segment cannot be empty");
  return segment;
}

export class InputArtifactStore {
  readonly #rootDirectory: string;
  readonly #clock: () => Date;

  constructor(options: InputArtifactStoreOptions) {
    this.#rootDirectory = resolve(options.rootDirectory);
    this.#clock = options.clock ?? (() => new Date());
  }

  async writeJson(input: {
    componentId: string;
    kind: ArtifactRef["kind"];
    label: string;
    value: unknown;
  }): Promise<ArtifactRef> {
    const bytes = Buffer.from(
      `${JSON.stringify(JSON.parse(canonicalJson(input.value)), null, 2)}\n`,
    );
    return this.write({ ...input, mediaType: "application/json", bytes });
  }

  async write(input: {
    componentId: string;
    kind: ArtifactRef["kind"];
    label: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<ArtifactRef> {
    const digest = contentDigest(input.bytes);
    const path = resolve(
      this.#rootDirectory,
      safeSegment(input.componentId),
      `${safeSegment(input.label)}-${digest.slice(0, 16)}.${extensionFor(input.mediaType)}`,
    );
    await mkdir(dirname(path), { recursive: true });
    try {
      if (!(await stat(path)).isFile()) await writeFile(path, input.bytes);
    } catch {
      await writeFile(path, input.bytes);
    }
    return ArtifactRefSchema.parse({
      artifactId: `${input.componentId}:input:${input.kind}:${safeSegment(input.label)}:${digest.slice(0, 16)}`,
      kind: input.kind,
      path,
      mediaType: input.mediaType,
      createdAt: this.#clock().toISOString(),
    });
  }
}
