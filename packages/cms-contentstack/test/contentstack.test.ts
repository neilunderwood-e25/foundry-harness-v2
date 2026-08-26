import { describe, expect, it } from "vitest";
import { ContentstackAdapter } from "../src/index.js";

describe("Contentstack adapter", () => {
  it("flattens nested groups and normalizes references", async () => {
    const fetcher = (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/entries?")) return Promise.resolve(Response.json({ entries: [] }));
      return Promise.resolve(
        Response.json({
          content_type: {
            title: "Hero",
            schema: [
              { uid: "title", display_name: "Title", data_type: "text", mandatory: true },
              {
                uid: "cta",
                display_name: "CTA",
                data_type: "group",
                schema: [
                  {
                    uid: "link",
                    display_name: "Link",
                    data_type: "reference",
                    reference_to: ["link"],
                  },
                ],
              },
            ],
          },
        }),
      );
    };
    const result = await new ContentstackAdapter({
      environment: {
        CONTENTSTACK_API_KEY: "key",
        CONTENTSTACK_DELIVERY_TOKEN: "token",
        CONTENTSTACK_ENVIRONMENT: "production",
      },
      fetch: fetcher as typeof globalThis.fetch,
    }).inspect(
      {
        provider: "contentstack",
        contentType: "hero",
        variantField: "variant",
        variantValue: "hero",
      },
      { fetchSampleEntry: true, timeoutMs: 10_000 },
    );
    expect(result.fields.map(({ path }) => path)).toEqual(["title", "cta", "cta.link"]);
    expect(result.fields[2]).toMatchObject({ kind: "reference", referenceTypes: ["link"] });
  });
});
