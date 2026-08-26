import { AgentProviderRegistry, type AgentProvider } from "@foundry/agent-runtime";
import {
  BatchExecutionRequestSchema,
  BatchDeliveryRequestSchema,
  ComponentBuildSpecSchema,
  FoundationInspectionRequestSchema,
  FoundationSetupRequestSchema,
  ProjectInspectionRequestSchema,
} from "@foundry/contracts";
import { inspectProjectFoundation, setupProjectFoundation } from "@foundry/foundation";
import { BatchInputPreparer } from "@foundry/input-preparation";
import {
  BatchDeliveryPipeline,
  BatchExecutor,
  DurableRunCoordinator,
  type DurableDeliveryRunner,
} from "@foundry/orchestrator";
import { PersistenceError, SqliteRunStore } from "@foundry/persistence";
import { inspectNextProject } from "@foundry/project-inspector";
import { ClaudeAgentProvider } from "@foundry/provider-claude";
import { CodexAgentProvider } from "@foundry/provider-codex";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function formatRunEventForSse(event: {
  sequence: number;
  payload: { type: string };
}): string {
  return `id: ${event.sequence}\nevent: ${event.payload.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createServer(
  options: {
    logger?: boolean;
    providers?: readonly AgentProvider[];
    databasePath?: string;
    deliveryRunnerFactory?: () => DurableDeliveryRunner;
  } = {},
) {
  const server = Fastify({ logger: options.logger ?? true });
  const providers = new AgentProviderRegistry(
    options.providers ?? [new CodexAgentProvider(), new ClaudeAgentProvider()],
  );
  const coordinator = new DurableRunCoordinator({
    repository: new SqliteRunStore({ databasePath: options.databasePath ?? ":memory:" }),
    deliveryRunnerFactory:
      options.deliveryRunnerFactory ?? (() => new BatchDeliveryPipeline({ providers })),
  });
  const recoveredRuns = coordinator.recoverInterruptedRuns();
  const consoleRoot = resolve("apps/console/dist");

  if (existsSync(join(consoleRoot, "index.html"))) {
    void server.register(fastifyStatic, { root: consoleRoot, prefix: "/console/" });
  }

  server.addHook("onClose", async () => coordinator.close());

  server.get("/health", async () => ({
    name: "foundry-harness-v2",
    status: "ok",
    recoveredRuns: recoveredRuns.length,
  }));

  server.get("/", async (_request, reply) => reply.redirect("/console/"));

  server.get("/api/runs", async (request, reply) => {
    const query = request.query as { limit?: string; projectId?: string };
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: "INVALID_LIMIT" });
    }
    return coordinator.listRuns({
      limit,
      ...(query.projectId ? { projectId: query.projectId } : {}),
    });
  });

  server.get("/api/runs/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const snapshot = coordinator.getSnapshot(runId);
    if (!snapshot) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    return snapshot;
  });

  server.get("/api/runs/:runId/events", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const query = request.query as { after?: string };
    const after = query.after === undefined ? -1 : Number(query.after);
    if (!Number.isInteger(after) || after < -1) {
      return reply.status(400).send({ error: "INVALID_SEQUENCE" });
    }
    try {
      return coordinator.listEvents(runId, after);
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "RUN_NOT_FOUND") {
        return reply.status(404).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  server.get("/api/runs/:runId/artifacts/:artifactId", async (request, reply) => {
    const { runId, artifactId } = request.params as { runId: string; artifactId: string };
    const snapshot = coordinator.getSnapshot(runId);
    if (!snapshot) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    const artifact = snapshot.artifacts.find((candidate) => candidate.artifactId === artifactId);
    if (!artifact) return reply.status(404).send({ error: "ARTIFACT_NOT_FOUND" });
    try {
      const contents = await readFile(artifact.path);
      const filename = basename(artifact.path).replace(/[^A-Za-z0-9._-]/g, "_");
      return reply
        .type(artifact.mediaType)
        .header("content-disposition", `inline; filename="${filename}"`)
        .send(contents);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        return reply.status(404).send({
          error: "ARTIFACT_FILE_MISSING",
          message: "The artifact record exists, but its file is no longer available.",
        });
      }
      throw error;
    }
  });

  server.get("/api/runs/:runId/events/stream", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    if (!coordinator.getRun(runId)) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    const query = request.query as { after?: string };
    const header = request.headers["last-event-id"];
    const after = Number(query.after ?? header ?? -1);
    if (!Number.isInteger(after) || after < -1) {
      return reply.status(400).send({ error: "INVALID_SEQUENCE" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 3000\n\n");
    const unsubscribe = coordinator.subscribe(runId, after, (event) => {
      reply.raw.write(formatRunEventForSse(event));
    });
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    request.raw.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return reply;
  });

  server.post("/api/runs/:runId/cancel", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    try {
      const result = coordinator.cancel(runId);
      return reply.status(result.accepted ? 202 : 409).send(result);
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "RUN_NOT_FOUND") {
        return reply.status(404).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  server.post("/api/runs/deliver/start", async (request, reply) => {
    const input = BatchDeliveryRequestSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: input.error.issues });
    }
    try {
      const run = coordinator.startDelivery(input.data);
      return reply.status(202).send({
        run,
        statusUrl: `/api/runs/${run.runId}`,
        eventsUrl: `/api/runs/${run.runId}/events/stream`,
      });
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "RUN_ALREADY_EXISTS") {
        return reply.status(409).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  server.post("/api/specifications/validate", async (request, reply) => {
    const result = ComponentBuildSpecSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ valid: false, issues: result.error.issues });
    }
    return { valid: true, specification: result.data };
  });

  server.post("/api/projects/inspect", async (request, reply) => {
    const input = ProjectInspectionRequestSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: input.error.issues });
    }
    return inspectNextProject({
      rootDir: input.data.rootDir,
      ...(input.data.projectId ? { projectId: input.data.projectId } : {}),
    });
  });

  server.post("/api/projects/foundation/inspect", async (request, reply) => {
    const input = FoundationInspectionRequestSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: input.error.issues });
    }
    const inspection = await inspectNextProject({
      rootDir: input.data.rootDir,
      ...(input.data.projectId ? { projectId: input.data.projectId } : {}),
    });
    if (inspection.status !== "supported") {
      return reply.status(422).send(inspection);
    }
    return inspectProjectFoundation(inspection.profile, {
      ...(input.data.previous ? { previous: input.data.previous } : {}),
      acceptChanges: input.data.acceptChanges,
    });
  });

  server.post("/api/projects/foundation/setup", async (request, reply) => {
    const input = FoundationSetupRequestSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: input.error.issues });
    }
    const inspection = await inspectNextProject({
      rootDir: input.data.rootDir,
      projectId: input.data.specification.projectId,
    });
    if (inspection.status !== "supported") {
      return reply.status(422).send(inspection);
    }
    try {
      return await setupProjectFoundation(inspection.profile, input.data.specification, {
        overwrite: input.data.overwrite,
      });
    } catch (error) {
      return reply.status(409).send({
        error: "FOUNDATION_SETUP_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.post("/api/runs/execute", async (request, reply) => {
    const input = BatchExecutionRequestSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: input.error.issues });
    }
    const events: unknown[] = [];
    try {
      const result = await new BatchExecutor({ providers }).execute(input.data, {
        onEvent(event) {
          events.push(event);
        },
      });
      return { result, events };
    } catch (error) {
      return reply.status(409).send({
        error: "BATCH_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        events,
      });
    }
  });

  server.post("/api/inputs/prepare", async (request, reply) => {
    const parsed = BatchDeliveryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: parsed.error.issues });
    }
    try {
      const input = BatchDeliveryRequestSchema.parse({
        ...parsed.data,
        inputPreparation: { ...parsed.data.inputPreparation, enabled: true },
      });
      return await new BatchInputPreparer().prepare(input);
    } catch (error) {
      return reply.status(409).send({
        error: "INPUT_PREPARATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.post("/api/runs/deliver", async (request, reply) => {
    const input = BatchDeliveryRequestSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: input.error.issues });
    }
    const events: unknown[] = [];
    try {
      const result = await new BatchDeliveryPipeline({ providers }).deliver(input.data, {
        onEvent(event) {
          events.push(event);
        },
      });
      return { result, events };
    } catch (error) {
      return reply.status(409).send({
        error: "BATCH_DELIVERY_FAILED",
        message: error instanceof Error ? error.message : String(error),
        events,
      });
    }
  });

  return server;
}

async function main(): Promise<void> {
  const port = Number(process.env["PORT"] ?? 4600);
  const databasePath = process.env["FOUNDRY_DATABASE_PATH"] ?? resolve(".foundry/state.sqlite");
  const server = createServer({ databasePath });
  await server.listen({ host: "127.0.0.1", port });
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  await main();
}
