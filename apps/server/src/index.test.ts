import { describe, expect, it } from "vitest";
import specification from "../../../examples/component-build-spec.json" with { type: "json" };
import delivery from "../../../examples/batch-delivery.json" with { type: "json" };
import {
  BatchDeliveryRequestSchema,
  BatchDeliveryResultSchema,
  RunEventSchema,
  type BatchDeliveryRequest,
} from "@foundry/contracts";
import type { DurableDeliveryRunner, RunEventSink } from "@foundry/orchestrator";
import { createServer, formatRunEventForSse } from "./index.js";

class ImmediateDeliveryRunner implements DurableDeliveryRunner {
  async deliver(input: BatchDeliveryRequest, options: { onEvent: RunEventSink }) {
    await options.onEvent(
      RunEventSchema.parse({
        schemaVersion: 1,
        eventId: `${input.batch.runId}:0`,
        runId: input.batch.runId,
        sequence: 0,
        occurredAt: new Date().toISOString(),
        payload: { type: "run.started" },
      }),
    );
    await options.onEvent(
      RunEventSchema.parse({
        schemaVersion: 1,
        eventId: `${input.batch.runId}:1`,
        runId: input.batch.runId,
        sequence: 1,
        occurredAt: new Date().toISOString(),
        payload: { type: "run.completed", status: "passed" },
      }),
    );
    return BatchDeliveryResultSchema.parse({
      schemaVersion: 1,
      runId: input.batch.runId,
      status: "passed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      jobs: [],
    });
  }
}

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

  it("validates batch delivery requests before starting providers", async () => {
    const server = createServer({ logger: false });
    const response = await server.inject({
      method: "POST",
      url: "/api/runs/deliver",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_REQUEST" });
    await server.close();
  });

  it("starts durable deliveries and exposes replayable state and events", async () => {
    const server = createServer({
      logger: false,
      deliveryRunnerFactory: () => new ImmediateDeliveryRunner(),
    });
    const request = BatchDeliveryRequestSchema.parse(delivery);
    const started = await server.inject({
      method: "POST",
      url: "/api/runs/deliver/start",
      payload: request,
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({
      run: { runId: "example-delivery-1" },
      statusUrl: "/api/runs/example-delivery-1",
    });
    await new Promise((resolve) => setImmediate(resolve));

    const snapshot = await server.inject({
      method: "GET",
      url: "/api/runs/example-delivery-1",
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({
      run: { status: "passed" },
      events: [{ sequence: 0 }, { sequence: 1 }],
    });
    const events = await server.inject({
      method: "GET",
      url: "/api/runs/example-delivery-1/events?after=0",
    });
    expect(events.json()).toMatchObject([{ sequence: 1 }]);

    const duplicate = await server.inject({
      method: "POST",
      url: "/api/runs/deliver/start",
      payload: request,
    });
    expect(duplicate.statusCode).toBe(409);
    await server.close();
  });

  it("formats resumable SSE messages", () => {
    expect(
      formatRunEventForSse({ sequence: 7, payload: { type: "verification.completed" } }),
    ).toContain("id: 7\nevent: verification.completed\ndata:");
  });
});
