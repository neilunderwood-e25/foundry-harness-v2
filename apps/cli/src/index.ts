#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { AgentProviderRegistry } from "@foundry/agent-runtime";
import {
  BatchExecutionRequestSchema,
  BatchDeliveryRequestSchema,
  ComponentBuildSpecSchema,
  FoundationSetupSpecSchema,
  type ProjectProfile,
} from "@foundry/contracts";
import { inspectProjectFoundation, setupProjectFoundation } from "@foundry/foundation";
import { BatchDeliveryPipeline, BatchExecutor } from "@foundry/orchestrator";
import { BatchInputPreparer } from "@foundry/input-preparation";
import { PersistenceError, SqliteRunStore } from "@foundry/persistence";
import { inspectNextProject } from "@foundry/project-inspector";
import { ClaudeAgentProvider } from "@foundry/provider-claude";
import { CodexAgentProvider } from "@foundry/provider-codex";
import { resolve } from "node:path";

function usage(): never {
  process.stderr.write(`Usage:
  foundry validate-spec <spec.json>
  foundry project inspect <project-dir> [project-id]
  foundry foundation inspect <project-dir> [project-id]
  foundry foundation setup <project-dir> <setup.json>
  foundry batch execute <execution.json>
  foundry batch prepare <delivery.json>
  foundry batch deliver <delivery.json>
  foundry run list [database-path]
  foundry run show <run-id> [database-path]
  foundry run events <run-id> [database-path]
`);
  process.exit(2);
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function databasePath(path?: string): string {
  return resolve(path ?? process.env["FOUNDRY_DATABASE_PATH"] ?? ".foundry/state.sqlite");
}

function readRunStore<T>(path: string | undefined, operation: (store: SqliteRunStore) => T): T {
  const store = new SqliteRunStore({ databasePath: databasePath(path) });
  try {
    return operation(store);
  } finally {
    store.close();
  }
}

async function inspectProfile(rootDir: string, projectId?: string): Promise<ProjectProfile> {
  const inspection = await inspectNextProject({
    rootDir,
    ...(projectId ? { projectId } : {}),
  });
  if (inspection.status !== "supported") {
    print(inspection);
    throw new Error("Project is not ready for Foundry");
  }
  return inspection.profile;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "validate-spec" && args[1]) {
    const result = ComponentBuildSpecSchema.safeParse(await readJson(args[1]));
    if (!result.success) {
      print(result.error.issues);
      process.exitCode = 1;
      return;
    }
    print(result.data);
    return;
  }

  if (args[0] === "project" && args[1] === "inspect" && args[2]) {
    print(
      await inspectNextProject({
        rootDir: args[2],
        ...(args[3] ? { projectId: args[3] } : {}),
      }),
    );
    return;
  }

  if (args[0] === "foundation" && args[1] === "inspect" && args[2]) {
    const profile = await inspectProfile(args[2], args[3]);
    print(await inspectProjectFoundation(profile));
    return;
  }

  if (args[0] === "foundation" && args[1] === "setup" && args[2] && args[3]) {
    const specification = FoundationSetupSpecSchema.parse(await readJson(args[3]));
    const profile = await inspectProfile(args[2], specification.projectId);
    print(await setupProjectFoundation(profile, specification));
    return;
  }

  if (args[0] === "batch" && args[1] === "execute" && args[2]) {
    const request = BatchExecutionRequestSchema.parse(await readJson(args[2]));
    const providers = new AgentProviderRegistry([
      new CodexAgentProvider(),
      new ClaudeAgentProvider(),
    ]);
    const executor = new BatchExecutor({ providers });
    const result = await executor.execute(request, {
      onEvent(event) {
        process.stderr.write(`${JSON.stringify(event)}\n`);
      },
    });
    print(result);
    if (result.status !== "completed") process.exitCode = 1;
    return;
  }

  if (args[0] === "batch" && args[1] === "prepare" && args[2]) {
    const parsed = BatchDeliveryRequestSchema.parse(await readJson(args[2]));
    const request = BatchDeliveryRequestSchema.parse({
      ...parsed,
      inputPreparation: { ...parsed.inputPreparation, enabled: true },
    });
    print(await new BatchInputPreparer().prepare(request));
    return;
  }

  if (args[0] === "batch" && args[1] === "deliver" && args[2]) {
    const request = BatchDeliveryRequestSchema.parse(await readJson(args[2]));
    const providers = new AgentProviderRegistry([
      new CodexAgentProvider(),
      new ClaudeAgentProvider(),
    ]);
    const result = await new BatchDeliveryPipeline({ providers }).deliver(request, {
      onEvent(event) {
        process.stderr.write(`${JSON.stringify(event)}\n`);
      },
    });
    print(result);
    if (result.status !== "passed") process.exitCode = 1;
    return;
  }

  if (args[0] === "run" && args[1] === "list") {
    print(readRunStore(args[2], (store) => store.listRuns()));
    return;
  }

  if (args[0] === "run" && args[1] === "show" && args[2]) {
    const snapshot = readRunStore(args[3], (store) => store.getSnapshot(args[2]!));
    if (!snapshot) throw new PersistenceError("RUN_NOT_FOUND", `Run ${args[2]} was not found`);
    print(snapshot);
    return;
  }

  if (args[0] === "run" && args[1] === "events" && args[2]) {
    print(readRunStore(args[3], (store) => store.listEvents(args[2]!)));
    return;
  }

  usage();
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
