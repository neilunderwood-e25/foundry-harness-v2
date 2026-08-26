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

function kindFor(dataType: unknown, field: JsonObject): CmsFieldKind {
  if (dataType === "text" || dataType === "isodate")
    return dataType === "isodate" ? "date" : "text";
  if (
    dataType === "json" &&
    field["field_metadata"] &&
    record(field["field_metadata"])?.["allow_json_rte"] === true
  )
    return "rich-text";
  if (dataType === "json") return "json";
  if (dataType === "number") return "number";
  if (dataType === "boolean") return "boolean";
  if (dataType === "file") return "asset";
  if (dataType === "reference" || dataType === "global_field") return "reference";
  if (dataType === "group") return "group";
  if (dataType === "blocks") return "blocks";
  return "unknown";
}

function flattenFields(
  fields: unknown,
  parentPath?: string,
): ReturnType<typeof CmsFieldSnapshotSchema.parse>[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((value) => {
    const field = record(value);
    if (!field) return [];
    const id = String(field["uid"] ?? "field");
    const path = parentPath ? `${parentPath}.${id}` : id;
    const referenceTo = Array.isArray(field["reference_to"])
      ? field["reference_to"].filter((item): item is string => typeof item === "string")
      : typeof field["reference_to"] === "string"
        ? [field["reference_to"]]
        : [];
    const current = CmsFieldSnapshotSchema.parse({
      id,
      name: String(field["display_name"] ?? id),
      path,
      ...(parentPath ? { parentPath } : {}),
      kind: kindFor(field["data_type"], field),
      cardinality: field["multiple"] === true ? "many" : "one",
      required: field["mandatory"] === true,
      localized: field["localized"] === true,
      referenceTypes: referenceTo,
      graphqlField: path.split(".").map(graphqlName).join("."),
    });
    const nested = field["data_type"] === "group" ? flattenFields(field["schema"], path) : [];
    return [current, ...nested];
  });
}

export interface ContentstackAdapterOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof globalThis.fetch;
}

export class ContentstackAdapter implements CmsAdapter {
  readonly provider = "contentstack" as const;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #fetch: typeof globalThis.fetch | undefined;

  constructor(options: ContentstackAdapterOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#fetch = options.fetch;
  }

  async inspect(reference: CmsTypeRef, options: CmsInspectionOptions): Promise<CmsInspection> {
    const credentials = requiredEnvironment(this.#environment, [
      "CONTENTSTACK_API_KEY",
      "CONTENTSTACK_DELIVERY_TOKEN",
      "CONTENTSTACK_ENVIRONMENT",
    ]);
    const host = this.#environment["CONTENTSTACK_CDA_HOST"] ?? "cdn.contentstack.io";
    const base = `https://${host}/v3/content_types/${encodeURIComponent(reference.contentType)}`;
    const headers = {
      api_key: credentials["CONTENTSTACK_API_KEY"]!,
      access_token: credentials["CONTENTSTACK_DELIVERY_TOKEN"]!,
    };
    const response = await fetchJson<JsonObject>(base, {
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
      headers,
      timeoutMs: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
      errorCode: "CONTENTSTACK_SCHEMA_FETCH_FAILED",
      description: `Contentstack content type ${reference.contentType}`,
    });
    const rawSchema = record(response["content_type"]) ?? response;
    let sampleEntry: unknown;
    if (options.fetchSampleEntry) {
      const url = new URL(`${base}/entries`);
      url.searchParams.set("environment", credentials["CONTENTSTACK_ENVIRONMENT"]!);
      url.searchParams.set("limit", "1");
      url.searchParams.set("include_count", "false");
      sampleEntry = await fetchJson<unknown>(url, {
        ...(this.#fetch ? { fetch: this.#fetch } : {}),
        headers,
        timeoutMs: options.timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
        errorCode: "CONTENTSTACK_SAMPLE_FETCH_FAILED",
        description: `Contentstack sample entry ${reference.contentType}`,
      });
    }
    return {
      provider: this.provider,
      contentType: reference.contentType,
      name: String(rawSchema["title"] ?? reference.contentType),
      graphqlType: reference.graphqlType ?? pascalCase(reference.contentType),
      fields: flattenFields(rawSchema["schema"]),
      rawSchema,
      ...(sampleEntry !== undefined ? { sampleEntry } : {}),
    };
  }
}
