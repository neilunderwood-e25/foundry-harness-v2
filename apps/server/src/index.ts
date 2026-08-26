import { AgentProviderRegistry, type AgentProvider } from "@foundry/agent-runtime";
import {
  BatchExecutionRequestSchema,
  BatchDeliveryRequestSchema,
  ComponentBuildSpecSchema,
  FoundationInspectionRequestSchema,
  FoundationSetupRequestSchema,
  ProjectRefreshRequestSchema,
  ProjectRegistrationRequestSchema,
  ProjectInspectionRequestSchema,
} from "@foundry/contracts";
import { inspectProjectFoundation, setupProjectFoundation } from "@foundry/foundation";
import { createDiagnosticsBundle } from "@foundry/diagnostics";
import { evaluateRuns } from "@foundry/evaluation";
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
import { redactSecrets, redactText } from "@foundry/security";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { selectProjectDirectory } from "./directory-picker.js";

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
    directoryPicker?: () => Promise<string | undefined>;
  } = {},
) {
  const server = Fastify({ logger: options.logger ?? true });
  const providers = new AgentProviderRegistry(
    options.providers ?? [new CodexAgentProvider(), new ClaudeAgentProvider()],
  );
  const repository = new SqliteRunStore({ databasePath: options.databasePath ?? ":memory:" });
  const coordinator = new DurableRunCoordinator({
    repository,
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

  server.get("/api/runs/:runId/diagnostics", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const snapshot = coordinator.getSnapshot(runId);
    if (!snapshot) return reply.status(404).send({ error: "RUN_NOT_FOUND" });
    const filename = `${runId.replace(/[^A-Za-z0-9._-]/g, "_")}-diagnostics.json`;
    return reply
      .type("application/json")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(createDiagnosticsBundle(snapshot));
  });

  server.get("/api/evaluations/summary", async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: "INVALID_LIMIT" });
    }
    const snapshots = coordinator
      .listRuns({ limit })
      .flatMap(({ runId }) => coordinator.getSnapshot(runId) ?? []);
    return evaluateRuns(snapshots);
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

  server.get("/api/projects", async () => repository.listProjects());

  server.post("/api/system/select-directory", async (_request, reply) => {
    try {
      const path = await (options.directoryPicker ?? selectProjectDirectory)();
      return { cancelled: path === undefined, ...(path ? { path } : {}) };
    } catch (error) {
      return reply.status(501).send({
        error: "DIRECTORY_PICKER_UNAVAILABLE",
        message: error instanceof Error ? error.message : "The directory picker is unavailable.",
      });
    }
  });

  server.get("/api/projects/:projectId", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = repository.getProject(projectId);
    if (!project) return reply.status(404).send({ error: "PROJECT_NOT_FOUND" });
    return project;
  });

  server.post("/api/projects/register", async (request, reply) => {
    const input = ProjectRegistrationRequestSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: input.error.issues });
    }
    const inspection = await inspectNextProject({
      rootDir: input.data.rootDir,
      ...(input.data.projectId ? { projectId: input.data.projectId } : {}),
    });
    if (inspection.status !== "supported") return reply.status(422).send(inspection);
    const previous = repository.getProject(inspection.profile.projectId)?.foundation;
    const foundation = await inspectProjectFoundation(inspection.profile, {
      ...(previous ? { previous } : {}),
      acceptChanges: input.data.acceptFoundationChanges,
    });
    return reply.status(201).send(repository.saveProject(inspection.profile, foundation));
  });

  server.post("/api/projects/:projectId/refresh", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const input = ProjectRefreshRequestSchema.safeParse(request.body ?? {});
    if (!input.success) {
      return reply.status(400).send({ error: "INVALID_REQUEST", issues: input.error.issues });
    }
    const existing = repository.getProject(projectId);
    if (!existing) return reply.status(404).send({ error: "PROJECT_NOT_FOUND" });
    const inspection = await inspectNextProject({ rootDir: existing.rootDir, projectId });
    if (inspection.status !== "supported") return reply.status(422).send(inspection);
    const foundation = await inspectProjectFoundation(inspection.profile, {
      previous: existing.foundation,
      acceptChanges: input.data.acceptFoundationChanges,
    });
    return repository.saveProject(inspection.profile, foundation);
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
      const foundation = await setupProjectFoundation(
        inspection.profile,
        input.data.specification,
        {
          overwrite: input.data.overwrite,
        },
      );
      if (repository.getProject(inspection.profile.projectId)) {
        repository.saveProject(inspection.profile, foundation);
      }
      return foundation;
    } catch (error) {
      return reply.status(409).send({
        error: "FOUNDATION_SETUP_FAILED",
        message: redactText(error instanceof Error ? error.message : String(error)),
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
      return redactSecrets({ result, events });
    } catch (error) {
      return reply.status(409).send({
        error: "BATCH_EXECUTION_FAILED",
        message: redactText(error instanceof Error ? error.message : String(error)),
        events: redactSecrets(events),
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
      return redactSecrets(await new BatchInputPreparer().prepare(input));
    } catch (error) {
      return reply.status(409).send({
        error: "INPUT_PREPARATION_FAILED",
        message: redactText(error instanceof Error ? error.message : String(error)),
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
      return redactSecrets({ result, events });
    } catch (error) {
      return reply.status(409).send({
        error: "BATCH_DELIVERY_FAILED",
        message: redactText(error instanceof Error ? error.message : String(error)),
        events: redactSecrets(events),
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
