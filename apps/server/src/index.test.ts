import { describe, expect, it } from "vitest";
import specification from "../../../examples/component-build-spec.json" with { type: "json" };
import { createServer } from "./index.js";

describe("server", () => {
  it("reports health", async () => {
    const server = createServer({ logger: false });
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
    await server.close();
  });

  it("validates component specifications", async () => {
    const server = createServer({ logger: false });
    const response = await server.inject({
      method: "POST",
      url: "/api/specifications/validate",
      payload: specification,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ valid: true });
    await server.close();
  });

  it("validates batch execution requests before starting providers", async () => {
    const server = createServer({ logger: false });
    const response = await server.inject({
      method: "POST",
      url: "/api/runs/execute",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_REQUEST" });
    await server.close();
  });
});
