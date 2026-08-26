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
import { BatchDeliveryPipeline, BatchExecutor } from "@foundry/orchestrator";
import { inspectNextProject } from "@foundry/project-inspector";
import { ClaudeAgentProvider } from "@foundry/provider-claude";
import { CodexAgentProvider } from "@foundry/provider-codex";
import Fastify from "fastify";
import { pathToFileURL } from "node:url";

export function createServer(
  options: { logger?: boolean; providers?: readonly AgentProvider[] } = {},
) {
  const server = Fastify({ logger: options.logger ?? true });
  const providers = new AgentProviderRegistry(
    options.providers ?? [new CodexAgentProvider(), new ClaudeAgentProvider()],
  );

  server.get("/health", async () => ({
    name: "foundry-harness-v2",
    status: "ok",
  }));

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
  const server = createServer();
  await server.listen({ host: "127.0.0.1", port });
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  await main();
}
