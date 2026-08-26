import { describe, expect, it } from "vitest";
import { ContentfulAdapter } from "../src/index.js";

describe("Contentful adapter", () => {
  it("normalizes fields and keeps credentials in request headers", async () => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const fetcher = (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.includes("/entries?"))
        return Promise.resolve(Response.json({ items: [{ fields: { title: "Hello" } }] }));
      return Promise.resolve(
        Response.json({
          name: "Hero",
          fields: [
            { id: "title", name: "Title", type: "Symbol", required: true, localized: true },
            {
              id: "images",
              name: "Images",
              type: "Array",
              items: { type: "Link", linkType: "Asset" },
            },
          ],
        }),
      );
    };
    const result = await new ContentfulAdapter({
      environment: { CONTENTFUL_SPACE_ID: "space", CONTENTFUL_DELIVERY_TOKEN: "secret" },
      fetch: fetcher as typeof globalThis.fetch,
    }).inspect(
      {
        provider: "contentful",
        contentType: "hero",
        variantField: "variant",
        variantValue: "hero",
      },
      { fetchSampleEntry: true, timeoutMs: 10_000 },
    );
    expect(result.fields).toMatchObject([
      { path: "title", kind: "text", required: true, localized: true },
      { path: "images", kind: "asset", cardinality: "many" },
    ]);
    expect(seen.every(({ authorization }) => authorization === "Bearer secret")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
