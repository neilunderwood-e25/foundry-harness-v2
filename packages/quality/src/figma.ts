import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ComponentBuildSpec } from "@foundry/contracts";
import { PNG } from "pngjs";
import { QualityError } from "./errors.js";
import type { DesignReference, DesignReferenceProvider, QualityBreakpoint } from "./types.js";

interface FigmaFrame {
  readonly fileKey: string;
  readonly nodeId: string;
}

function parseFrameUrl(value: string): FigmaFrame {
  const url = new URL(value);
  const match = url.pathname.match(/^\/(?:design|file)\/([^/]+)/);
  const node = url.searchParams.get("node-id");
  if (!match?.[1] || !node) {
    throw new QualityError({
      code: "FIGMA_FRAME_URL_INVALID",
      message: `Cannot parse Figma file key and node ID from ${value}`,
    });
  }
  return { fileKey: match[1], nodeId: node.includes(":") ? node : node.replace(/-/g, ":") };
}

async function pngDimensions(path: string): Promise<{ width: number; height: number }> {
  const png = PNG.sync.read(await readFile(path));
  return { width: png.width, height: png.height };
}

async function validCachedPng(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile() && (await pngDimensions(path)).width > 0;
  } catch {
    return false;
  }
}

export interface FigmaRestReferenceProviderOptions {
  readonly fetch?: typeof globalThis.fetch;
}

export class FigmaRestReferenceProvider implements DesignReferenceProvider {
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: FigmaRestReferenceProviderOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async exportReferences(input: {
    specification: ComponentBuildSpec;
    outputDirectory: string;
    tokenEnvironmentVariable: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<DesignReference[]> {
    const token = process.env[input.tokenEnvironmentVariable];
    if (!token) {
      throw new QualityError({
        code: "FIGMA_TOKEN_MISSING",
        message: `${input.tokenEnvironmentVariable} is required for visual QA`,
      });
    }
    await mkdir(input.outputDirectory, { recursive: true });
    const frames: Array<{ label: QualityBreakpoint; url: string }> = [
      { label: "desktop", url: input.specification.design.desktopFrameUrl },
      { label: "mobile", url: input.specification.design.mobileFrameUrl },
    ];
    const references: DesignReference[] = [];
    const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
    const requestSignal = input.signal
      ? AbortSignal.any([input.signal, timeoutSignal])
      : timeoutSignal;
    for (const frame of frames) {
      const outputPath = resolve(input.outputDirectory, `${frame.label}-reference.png`);
      if (!(await validCachedPng(outputPath))) {
        const parsed = parseFrameUrl(frame.url);
        const endpoint = new URL(
          `https://api.figma.com/v1/images/${encodeURIComponent(parsed.fileKey)}`,
        );
        endpoint.searchParams.set("ids", parsed.nodeId);
        endpoint.searchParams.set("format", "png");
        endpoint.searchParams.set("scale", "1");
        const response = await this.#fetch(endpoint, {
          headers: { "X-Figma-Token": token },
          signal: requestSignal,
        });
        if (!response.ok) {
          throw new QualityError({
            code: "FIGMA_EXPORT_FAILED",
            message: `Figma image export failed with HTTP ${response.status}`,
          });
        }
        const payload = (await response.json()) as {
          err?: string | null;
          images?: Record<string, string | null>;
        };
        const imageUrl = payload.images?.[parsed.nodeId];
        if (!imageUrl) {
          throw new QualityError({
            code: "FIGMA_EXPORT_MISSING",
            message: payload.err ?? `Figma did not return an image for node ${parsed.nodeId}`,
          });
        }
        const image = await this.#fetch(imageUrl, {
          signal: requestSignal,
        });
        if (!image.ok) {
          throw new QualityError({
            code: "FIGMA_DOWNLOAD_FAILED",
            message: `Figma image download failed with HTTP ${image.status}`,
          });
        }
        await writeFile(outputPath, Buffer.from(await image.arrayBuffer()));
      }
      const dimensions = await pngDimensions(outputPath);
      references.push({
        label: frame.label,
        sourceUrl: frame.url,
        path: outputPath,
        ...dimensions,
      });
    }
    return references;
  }
}
