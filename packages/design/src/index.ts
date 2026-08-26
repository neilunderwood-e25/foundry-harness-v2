import {
  DesignFrameSnapshotSchema,
  DesignSnapshotSchema,
  type ArtifactRef,
  type ComponentBuildSpec,
  type DesignAssetObservation,
  type DesignColorObservation,
  type DesignComponentInstance,
  type DesignFrameSnapshot,
  type DesignSnapshot,
  type SpacingObservation,
  type TypographyObservation,
} from "@foundry/contracts";
import {
  InputArtifactStore,
  InputPreparationError,
  contentDigest,
  fetchBytes,
  fetchJson,
} from "@foundry/input-core";

export interface FigmaFrameReference {
  readonly sourceUrl: string;
  readonly fileKey: string;
  readonly nodeId: string;
}

export function parseFigmaFrameUrl(sourceUrl: string): FigmaFrameReference {
  const url = new URL(sourceUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const fileMarker = segments.findIndex((segment) => ["design", "file", "proto"].includes(segment));
  const fileKey = fileMarker >= 0 ? segments[fileMarker + 1] : undefined;
  const nodeId = url.searchParams.get("node-id")?.replaceAll("-", ":");
  if (!fileKey || !nodeId) {
    throw new InputPreparationError({
      code: "INVALID_FIGMA_URL",
      message: `Figma frame URL must contain a file key and node-id: ${sourceUrl}`,
    });
  }
  return { sourceUrl, fileKey, nodeId };
}

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function children(node: JsonObject): JsonObject[] {
  return Array.isArray(node["children"])
    ? node["children"].map(record).filter((item): item is JsonObject => item !== undefined)
    : [];
}

function walk(root: JsonObject): JsonObject[] {
  const result: JsonObject[] = [];
  const visit = (node: JsonObject): void => {
    result.push(node);
    for (const child of children(node)) visit(child);
  };
  visit(root);
  return result;
}

function stringValue(value: unknown, fallback = "Unknown"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function count<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

function hexChannel(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0");
}

function paintColor(paint: JsonObject): string | undefined {
  if (paint["type"] !== "SOLID" || paint["visible"] === false) return undefined;
  const color = record(paint["color"]);
  if (!color) return undefined;
  const red = numberValue(color["r"]);
  const green = numberValue(color["g"]);
  const blue = numberValue(color["b"]);
  if (red === undefined || green === undefined || blue === undefined) return undefined;
  const alpha = numberValue(paint["opacity"]);
  return `#${hexChannel(red)}${hexChannel(green)}${hexChannel(blue)}${alpha !== undefined && alpha < 1 ? hexChannel(alpha) : ""}`.toUpperCase();
}

function allPaints(node: JsonObject): JsonObject[] {
  return [node["fills"], node["strokes"]].flatMap((value) =>
    Array.isArray(value)
      ? value.map(record).filter((item): item is JsonObject => item !== undefined)
      : [],
  );
}

function observations(nodes: readonly JsonObject[]): {
  colors: DesignColorObservation[];
  typography: TypographyObservation[];
  spacing: SpacingObservation[];
} {
  const colorValues = nodes.flatMap((node) => allPaints(node).map(paintColor).filter(Boolean));
  const colors = [...count(colorValues, String)].map(([value, occurrences]) => ({
    value,
    occurrences,
  }));

  const typographyValues = nodes.flatMap((node) => {
    if (node["type"] !== "TEXT") return [];
    const style = record(node["style"]);
    if (!style) return [];
    const fontFamily = stringValue(style["fontFamily"], "Inter");
    const fontSize = numberValue(style["fontSize"]);
    const fontWeight = numberValue(style["fontWeight"]);
    if (!fontSize || !fontWeight) return [];
    return [
      {
        fontFamily,
        fontSize,
        fontWeight: Math.round(fontWeight),
        ...(numberValue(style["lineHeightPx"]) !== undefined
          ? { lineHeight: numberValue(style["lineHeightPx"]) }
          : {}),
        ...(numberValue(style["letterSpacing"]) !== undefined
          ? { letterSpacing: numberValue(style["letterSpacing"]) }
          : {}),
      },
    ];
  });
  const typographyCounts = count(typographyValues, (item) => JSON.stringify(item));
  const typography = [...typographyCounts].map(([serialized, occurrences]) => ({
    ...(JSON.parse(serialized) as Omit<TypographyObservation, "occurrences">),
    occurrences,
  }));

  const spacingValues = nodes.flatMap((node) =>
    ["itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]
      .map((key) => numberValue(node[key]))
      .filter((value): value is number => value !== undefined && value >= 0),
  );
  const spacing = [...count(spacingValues, String)].map(([value, occurrences]) => ({
    value: Number(value),
    occurrences,
  }));
  return { colors, typography, spacing };
}

export interface FigmaRestClientOptions {
  readonly token: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBaseUrl?: string;
}

export class FigmaRestClient {
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch | undefined;
  readonly #apiBaseUrl: string;

  constructor(options: FigmaRestClientOptions) {
    this.#token = options.token;
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetch;
    this.#apiBaseUrl = options.apiBaseUrl ?? "https://api.figma.com/v1";
  }

  async getNode(reference: FigmaFrameReference, signal?: AbortSignal): Promise<JsonObject> {
    const url = new URL(`${this.#apiBaseUrl}/files/${reference.fileKey}/nodes`);
    url.searchParams.set("ids", reference.nodeId);
    const response = await fetchJson<JsonObject>(url, {
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
      headers: { "X-Figma-Token": this.#token },
      timeoutMs: this.#timeoutMs,
      ...(signal ? { signal } : {}),
      errorCode: "FIGMA_NODE_FETCH_FAILED",
      description: `Figma node ${reference.nodeId}`,
    });
    const nodes = record(response["nodes"]);
    const entry = nodes ? record(nodes[reference.nodeId]) : undefined;
    const document = entry ? record(entry["document"]) : undefined;
    if (!document) {
      throw new InputPreparationError({
        code: "FIGMA_NODE_MISSING",
        message: `Figma did not return node ${reference.nodeId}`,
      });
    }
    return document;
  }

  async exportNode(
    reference: FigmaFrameReference,
    format: "png" | "svg",
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const url = new URL(`${this.#apiBaseUrl}/images/${reference.fileKey}`);
    url.searchParams.set("ids", reference.nodeId);
    url.searchParams.set("format", format);
    if (format === "png") url.searchParams.set("scale", "1");
    const response = await fetchJson<JsonObject>(url, {
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
      headers: { "X-Figma-Token": this.#token },
      timeoutMs: this.#timeoutMs,
      ...(signal ? { signal } : {}),
      errorCode: "FIGMA_EXPORT_FAILED",
      description: `Figma ${format} export ${reference.nodeId}`,
    });
    const images = record(response["images"]);
    const imageUrl = images?.[reference.nodeId];
    if (typeof imageUrl !== "string") {
      throw new InputPreparationError({
        code: "FIGMA_EXPORT_MISSING",
        message: `Figma did not produce a ${format} export for ${reference.nodeId}`,
      });
    }
    return fetchBytes(imageUrl, {
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
      timeoutMs: this.#timeoutMs,
      ...(signal ? { signal } : {}),
      errorCode: "FIGMA_EXPORT_DOWNLOAD_FAILED",
      description: `Figma ${format} download ${reference.nodeId}`,
    });
  }

  async getImageFillUrls(fileKey: string, signal?: AbortSignal): Promise<Record<string, string>> {
    const response = await fetchJson<JsonObject>(`${this.#apiBaseUrl}/files/${fileKey}/images`, {
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
      headers: { "X-Figma-Token": this.#token },
      timeoutMs: this.#timeoutMs,
      ...(signal ? { signal } : {}),
      errorCode: "FIGMA_IMAGE_FILLS_FETCH_FAILED",
      description: `Figma image fills for ${fileKey}`,
    });
    const meta = record(response["meta"]);
    const images = record(meta?.["images"]);
    return Object.fromEntries(
      Object.entries(images ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  async download(url: string, signal?: AbortSignal) {
    return fetchBytes(url, {
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
      timeoutMs: this.#timeoutMs,
      ...(signal ? { signal } : {}),
      errorCode: "FIGMA_ASSET_DOWNLOAD_FAILED",
      description: "Figma image asset",
    });
  }
}

export interface FigmaDesignIngestorOptions {
  readonly token: string;
  readonly outputRoot: string;
  readonly timeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: () => Date;
  readonly apiBaseUrl?: string;
}

export interface IngestedDesign {
  readonly snapshot: DesignSnapshot;
  readonly snapshotArtifact: ArtifactRef;
}

export class FigmaDesignIngestor {
  readonly #client: FigmaRestClient;
  readonly #store: InputArtifactStore;
  readonly #clock: () => Date;

  constructor(options: FigmaDesignIngestorOptions) {
    this.#client = new FigmaRestClient(options);
    this.#store = new InputArtifactStore({
      rootDirectory: options.outputRoot,
      ...(options.clock ? { clock: options.clock } : {}),
    });
    this.#clock = options.clock ?? (() => new Date());
  }

  async ingest(specification: ComponentBuildSpec, signal?: AbortSignal): Promise<IngestedDesign> {
    const desktopReference = parseFigmaFrameUrl(specification.design.desktopFrameUrl);
    const mobileReference = parseFigmaFrameUrl(specification.design.mobileFrameUrl);
    const [desktop, mobile] = await Promise.all([
      this.#ingestFrame(specification.componentId, "desktop", desktopReference, signal),
      this.#ingestFrame(specification.componentId, "mobile", mobileReference, signal),
    ]);
    const capturedAt = this.#clock().toISOString();
    const digest = contentDigest({ desktop: desktop.nodeDigest, mobile: mobile.nodeDigest });
    const snapshot = DesignSnapshotSchema.parse({
      schemaVersion: 1,
      componentId: specification.componentId,
      capturedAt,
      digest,
      desktop,
      mobile,
      artifacts: [
        desktop.screenshot,
        mobile.screenshot,
        ...desktop.assets.flatMap(({ artifact }) => (artifact ? [artifact] : [])),
        ...mobile.assets.flatMap(({ artifact }) => (artifact ? [artifact] : [])),
      ],
    });
    const snapshotArtifact = await this.#store.writeJson({
      componentId: specification.componentId,
      kind: "design",
      label: "design-snapshot",
      value: snapshot,
    });
    return { snapshot, snapshotArtifact };
  }

  async #ingestFrame(
    componentId: string,
    viewport: "desktop" | "mobile",
    reference: FigmaFrameReference,
    signal?: AbortSignal,
  ): Promise<DesignFrameSnapshot> {
    const [root, exported] = await Promise.all([
      this.#client.getNode(reference, signal),
      this.#client.exportNode(reference, "png", signal),
    ]);
    const screenshot = await this.#store.write({
      componentId,
      kind: "screenshot",
      label: `${viewport}-figma`,
      mediaType:
        exported.mediaType === "application/octet-stream" ? "image/png" : exported.mediaType,
      bytes: exported.bytes,
    });
    const nodes = walk(root);
    const boundingBox = record(root["absoluteBoundingBox"]);
    const width = numberValue(boundingBox?.["width"]) ?? numberValue(root["width"]);
    const height = numberValue(boundingBox?.["height"]) ?? numberValue(root["height"]);
    if (!width || !height) {
      throw new InputPreparationError({
        code: "FIGMA_FRAME_DIMENSIONS_MISSING",
        message: `Figma node ${reference.nodeId} has no usable frame dimensions`,
      });
    }
    const { colors, typography, spacing } = observations(nodes);
    const typeCounts = count(nodes, (node) => stringValue(node["type"]));
    const componentInstances: DesignComponentInstance[] = nodes
      .filter((node) => node["type"] === "INSTANCE")
      .map((node) => ({
        nodeId: stringValue(node["id"]),
        name: stringValue(node["name"]),
        ...(typeof node["componentId"] === "string" ? { componentId: node["componentId"] } : {}),
      }));
    const observedAssets: DesignAssetObservation[] = nodes.flatMap((node) =>
      allPaints(node)
        .filter((paint) => paint["type"] === "IMAGE" && typeof paint["imageRef"] === "string")
        .map((paint) => ({
          nodeId: stringValue(node["id"]),
          name: stringValue(node["name"]),
          kind: "image-fill" as const,
          imageRef: paint["imageRef"] as string,
        })),
    );
    const imageFillUrls =
      observedAssets.length > 0
        ? await this.#client.getImageFillUrls(reference.fileKey, signal)
        : {};
    const downloadedByRef = new Map<string, ArtifactRef>();
    for (const asset of observedAssets.slice(0, 25)) {
      if (!asset.imageRef || downloadedByRef.has(asset.imageRef)) continue;
      const imageUrl = imageFillUrls[asset.imageRef];
      if (!imageUrl) continue;
      const downloaded = await this.#client.download(imageUrl, signal);
      downloadedByRef.set(
        asset.imageRef,
        await this.#store.write({
          componentId,
          kind: "design",
          label: `${viewport}-asset-${asset.imageRef}`,
          mediaType: downloaded.mediaType,
          bytes: downloaded.bytes,
        }),
      );
    }
    const assets = observedAssets.map((asset) => ({
      ...asset,
      ...(asset.imageRef && downloadedByRef.get(asset.imageRef)
        ? { artifact: downloadedByRef.get(asset.imageRef) }
        : {}),
    }));
    return DesignFrameSnapshotSchema.parse({
      sourceUrl: reference.sourceUrl,
      fileKey: reference.fileKey,
      nodeId: reference.nodeId,
      name: stringValue(root["name"]),
      width,
      height,
      ...(typeof root["layoutMode"] === "string" ? { layoutMode: root["layoutMode"] } : {}),
      childCount: children(root).length,
      nodeDigest: contentDigest(root),
      nodeTypeCounts: Object.fromEntries(typeCounts),
      colors,
      typography,
      spacing,
      componentInstances,
      assets,
      screenshot,
    });
  }
}
