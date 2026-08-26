#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AgentProviderRegistry } from "@foundry/agent-runtime";
import {
  BatchExecutionRequestSchema,
  BatchDeliveryRequestSchema,
  ComponentBuildSpecSchema,
  FoundationSetupSpecSchema,
  EvaluationPolicySchema,
  type ProjectFoundation,
  type ProjectProfile,
  type RegisteredProject,
} from "@foundry/contracts";
import { createDiagnosticsBundle } from "@foundry/diagnostics";
import { evaluateRuns } from "@foundry/evaluation";
import { inspectProjectFoundation, setupProjectFoundation } from "@foundry/foundation";
import { BatchDeliveryPipeline, BatchExecutor } from "@foundry/orchestrator";
import { BatchInputPreparer } from "@foundry/input-preparation";
import { PersistenceError, SqliteRunStore } from "@foundry/persistence";
import { inspectNextProject } from "@foundry/project-inspector";
import { ClaudeAgentProvider } from "@foundry/provider-claude";
import { CodexAgentProvider } from "@foundry/provider-codex";
import { redactSecrets, redactText } from "@foundry/security";
import { dirname, resolve } from "node:path";

function usage(): never {
  process.stderr.write(`Usage:
  foundry validate-spec <spec.json>
  foundry project add <project-dir> [project-id] [database-path]
  foundry project list [database-path]
  foundry project show <project-id> [database-path]
  foundry project refresh <project-id> [database-path] [--accept-changes]
  foundry project inspect <project-dir> [project-id]
  foundry foundation inspect <project-dir> [project-id]
  foundry foundation setup <project-dir> <setup.json>
  foundry batch execute <execution.json>
  foundry batch prepare <delivery.json>
  foundry batch deliver <delivery.json>
  foundry run list [database-path]
  foundry run show <run-id> [database-path]
  foundry run events <run-id> [database-path]
  foundry run diagnostics <run-id> [output-path] [database-path]
  foundry evaluate [database-path] [policy.json] [output-path]
`);
  process.exit(2);
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(redactSecrets(value), null, 2)}\n`);
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

async function inspectFoundation(
  rootDir: string,
  projectId: string | undefined,
  previous?: ProjectFoundation,
  acceptChanges = false,
): Promise<{ profile: ProjectProfile; foundation: ProjectFoundation }> {
  const profile = await inspectProfile(rootDir, projectId);
  const foundation = await inspectProjectFoundation(profile, {
    ...(previous ? { previous } : {}),
    acceptChanges,
  });
  return { profile, foundation };
}

async function registerProject(
  rootDir: string,
  projectId: string | undefined,
  path: string | undefined,
): Promise<RegisteredProject> {
  const store = new SqliteRunStore({ databasePath: databasePath(path) });
  try {
    const inspected = await inspectFoundation(rootDir, projectId);
    const previous = store.getProject(inspected.profile.projectId)?.foundation;
    const foundation = previous
      ? await inspectProjectFoundation(inspected.profile, { previous })
      : inspected.foundation;
    return store.saveProject(inspected.profile, foundation);
  } finally {
    store.close();
  }
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

  if (args[0] === "project" && args[1] === "add" && args[2]) {
    print(await registerProject(args[2], args[3], args[4]));
    return;
  }

  if (args[0] === "project" && args[1] === "list") {
    print(readRunStore(args[2], (store) => store.listProjects()));
    return;
  }

  if (args[0] === "project" && args[1] === "show" && args[2]) {
    print(readRunStore(args[3], (store) => store.requireProject(args[2]!)));
    return;
  }

  if (args[0] === "project" && args[1] === "refresh" && args[2]) {
    const acceptChanges = args.includes("--accept-changes");
    const path = args[3] === "--accept-changes" ? undefined : args[3];
    const store = new SqliteRunStore({ databasePath: databasePath(path) });
    try {
      const existing = store.requireProject(args[2]);
      const { profile, foundation } = await inspectFoundation(
        existing.rootDir,
        existing.projectId,
        existing.foundation,
        acceptChanges,
      );
      print(store.saveProject(profile, foundation));
    } finally {
      store.close();
    }
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

  if (args[0] === "run" && args[1] === "diagnostics" && args[2]) {
    const outputPath = resolve(args[3] ?? `.foundry/diagnostics/${args[2]}-diagnostics.json`);
    const snapshot = readRunStore(args[4], (store) => store.getSnapshot(args[2]!));
    if (!snapshot) throw new PersistenceError("RUN_NOT_FOUND", `Run ${args[2]} was not found`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(createDiagnosticsBundle(snapshot), null, 2)}\n`);
    print({ runId: args[2], path: outputPath, secretsRedacted: true });
    return;
  }

  if (args[0] === "evaluate") {
    const store = new SqliteRunStore({ databasePath: databasePath(args[1]) });
    try {
      const snapshots = store
        .listRuns({ limit: 200 })
        .flatMap(({ runId }) => store.getSnapshot(runId) ?? []);
      const policy = args[2]
        ? EvaluationPolicySchema.parse(await readJson(args[2]))
        : EvaluationPolicySchema.parse({});
      const report = evaluateRuns(snapshots, policy);
      if (args[3]) {
        const outputPath = resolve(args[3]);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      }
      print(report);
      if (report.verdict !== "passed") process.exitCode = 1;
    } finally {
      store.close();
    }
    return;
  }

  usage();
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
}
