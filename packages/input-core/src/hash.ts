import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function contentDigest(value: unknown): string {
  if (value instanceof Uint8Array) {
    return createHash("sha256").update(value).digest("hex");
  }
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
