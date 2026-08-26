#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { AgentProviderRegistry } from "@foundry/agent-runtime";
import {
  BatchExecutionRequestSchema,
  ComponentBuildSpecSchema,
  FoundationSetupSpecSchema,
  type ProjectProfile,
} from "@foundry/contracts";
import { inspectProjectFoundation, setupProjectFoundation } from "@foundry/foundation";
import { BatchExecutor } from "@foundry/orchestrator";
import { inspectNextProject } from "@foundry/project-inspector";
import { ClaudeAgentProvider } from "@foundry/provider-claude";
import { CodexAgentProvider } from "@foundry/provider-codex";

function usage(): never {
  process.stderr.write(`Usage:
  foundry validate-spec <spec.json>
  foundry project inspect <project-dir> [project-id]
  foundry foundation inspect <project-dir> [project-id]
  foundry foundation setup <project-dir> <setup.json>
  foundry batch execute <execution.json>
`);
  process.exit(2);
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
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

  usage();
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
