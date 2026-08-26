import {
  graphqlName,
  pascalCase,
  requiredEnvironment,
  type CmsAdapter,
  type CmsInspection,
  type CmsInspectionOptions,
} from "@foundry/cms-core";
import { CmsFieldSnapshotSchema, type CmsFieldKind, type CmsTypeRef } from "@foundry/contracts";
import { fetchJson } from "@foundry/input-core";

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function kindFor(type: unknown, linkType: unknown): CmsFieldKind {
  if (type === "Symbol" || type === "Text") return "text";
  if (type === "RichText") return "rich-text";
  if (type === "Integer") return "integer";
  if (type === "Number") return "number";
  if (type === "Boolean") return "boolean";
  if (type === "Date") return "date";
  if (type === "Object") return "json";
  if (type === "Location") return "location";
  if (type === "Link" && linkType === "Asset") return "asset";
  if (type === "Link") return "reference";
  return "unknown";
}

function referenceTypes(field: JsonObject): string[] {
  const candidates = [field, record(field["items"])].filter(
    (item): item is JsonObject => item !== undefined,
  );
  return candidates.flatMap((candidate) =>
    Array.isArray(candidate["validations"])
      ? candidate["validations"].flatMap((validation) => {
          const value = record(validation);
          return Array.isArray(value?.["linkContentType"])
            ? value["linkContentType"].filter((item): item is string => typeof item === "string")
            : [];
        })
      : [],
  );
}

export interface ContentfulAdapterOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof globalThis.fetch;
}

export class ContentfulAdapter implements CmsAdapter {
  readonly provider = "contentful" as const;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #fetch: typeof globalThis.fetch | undefined;

  constructor(options: ContentfulAdapterOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#fetch = options.fetch;
  }

  async inspect(reference: CmsTypeRef, options: CmsInspectionOptions): Promise<CmsInspection> {
    const credentials = requiredEnvironment(this.#environment, [
      "CONTENTFUL_SPACE_ID",
      "CONTENTFUL_DELIVERY_TOKEN",
    ]);
    const host = this.#environment["CONTENTFUL_CDA_HOST"] ?? "cdn.contentful.com";
    const environmentId = this.#environment["CONTENTFUL_ENVIRONMENT_ID"] ?? "master";
    const base = `https://${host}/spaces/${encodeURIComponent(credentials["CONTENTFUL_SPACE_ID"]!)}/environments/${encodeURIComponent(environmentId)}`;
    const headers = { Authorization: `Bearer ${credentials["CONTENTFUL_DELIVERY_TOKEN"]!}` };
    const rawSchema = await fetchJson<JsonObject>(
      `${base}/content_types/${encodeURIComponent(reference.contentType)}`,
      {
        ...(this.#fetch ? { fetch: this.#fetch } : {}),
        headers,
        timeoutMs: options.timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
        errorCode: "CONTENTFUL_SCHEMA_FETCH_FAILED",
        description: `Contentful content type ${reference.contentType}`,
      },
    );
    const fields = Array.isArray(rawSchema["fields"])
      ? rawSchema["fields"]
          .map((value) => record(value))
          .filter((value): value is JsonObject => !!value)
      : [];
    const normalized = fields.map((field) => {
      const items = record(field["items"]);
      const type = field["type"] === "Array" ? items?.["type"] : field["type"];
      const linkType = field["type"] === "Array" ? items?.["linkType"] : field["linkType"];
      const id = String(field["id"] ?? "field");
      return CmsFieldSnapshotSchema.parse({
        id,
        name: String(field["name"] ?? id),
        path: id,
        kind: kindFor(type, linkType),
        cardinality: field["type"] === "Array" ? "many" : "one",
        required: field["required"] === true,
        localized: field["localized"] === true,
        referenceTypes: referenceTypes(field),
        graphqlField: graphqlName(id),
      });
    });
    let sampleEntry: unknown;
    if (options.fetchSampleEntry) {
      const url = new URL(`${base}/entries`);
      url.searchParams.set("content_type", reference.contentType);
      url.searchParams.set("limit", "1");
      url.searchParams.set("include", "2");
      sampleEntry = await fetchJson<unknown>(url, {
        ...(this.#fetch ? { fetch: this.#fetch } : {}),
        headers,
        timeoutMs: options.timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
        errorCode: "CONTENTFUL_SAMPLE_FETCH_FAILED",
        description: `Contentful sample entry ${reference.contentType}`,
      });
    }
    return {
      provider: this.provider,
      contentType: reference.contentType,
      name: String(rawSchema["name"] ?? reference.contentType),
      graphqlType: reference.graphqlType ?? pascalCase(reference.contentType),
      fields: normalized,
      rawSchema,
      ...(sampleEntry !== undefined ? { sampleEntry } : {}),
    };
  }
}
