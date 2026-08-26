import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets, redactText } from "../src/index.js";

describe("secret redaction", () => {
  it("redacts known environment values and token-shaped text", () => {
    const environment = { FIGMA_TOKEN: "figma-secret-value" };
    expect(
      redactText("Bearer abcdefghijkl and figma-secret-value and sk-ant-abcdefghijk", {
        environment,
      }),
    ).toBe(`${REDACTED} and ${REDACTED} and ${REDACTED}`);
  });

  it("redacts sensitive object fields recursively without mutating the input", () => {
    const input = {
      authorization: "Bearer abcdefghijkl",
      nested: [{ token: "secret-token", label: "safe" }],
    };
    const output = redactSecrets(input, { environment: {} });
    expect(output).toEqual({
      authorization: REDACTED,
      nested: [{ token: REDACTED, label: "safe" }],
    });
    expect(input.nested[0]?.token).toBe("secret-token");
  });
});
