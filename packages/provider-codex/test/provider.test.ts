import type { AgentExecutionRequest, AgentStreamEvent } from "@foundry/agent-runtime";
import type {
  ComponentBuildSpec,
  ProjectProfile,
  ReadyProjectFoundation,
} from "@foundry/contracts";
import type { ThreadEvent, ThreadOptions } from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";
import { CodexAgentProvider, type CodexClient } from "../src/index.js";

function request(): AgentExecutionRequest {
  return {
    jobId: "run:hero",
    workingDirectory: "/tmp/worktree",
    prompt: "Build the hero",
    specification: {
      agent: { provider: "codex", model: "gpt-test", reasoningEffort: "high" },
    } as ComponentBuildSpec,
    project: {} as ProjectProfile,
    foundation: {} as ReadyProjectFoundation,
  };
}

async function* events(): AsyncGenerator<ThreadEvent> {
  yield { type: "thread.started", thread_id: "thread-1" };
  yield {
    type: "item.started",
    item: {
      id: "command-1",
      type: "command_execution",
      command: "pnpm test",
      aggregated_output: "",
      status: "in_progress",
    },
  };
  yield {
    type: "item.completed",
    item: {
      id: "command-1",
      type: "command_execution",
      command: "pnpm test",
      aggregated_output: "passed",
      exit_code: 0,
      status: "completed",
    },
  };
  yield {
    type: "item.completed",
    item: { id: "message-1", type: "agent_message", text: "Hero is ready" },
  };
  yield {
    type: "turn.completed",
    usage: {
      input_tokens: 1,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
    },
  };
}

describe("Codex provider", () => {
  it("normalizes SDK stream events and preserves thread options", async () => {
    let threadOptions: ThreadOptions | undefined;
    const client: CodexClient = {
      startThread(options) {
        threadOptions = options;
        return {
          async runStreamed() {
            return { events: events() };
          },
        };
      },
      resumeThread() {
        throw new Error("Not expected in this test");
      },
    };
    const provider = new CodexAgentProvider({ client, networkAccessEnabled: false });
    const emitted: AgentStreamEvent[] = [];
    const result = await provider.execute(request(), (event) => {
      emitted.push(event);
    });

    expect(result).toEqual({
      status: "completed",
      sessionId: "thread-1",
      summary: "Hero is ready",
    });
    expect(threadOptions).toMatchObject({
      workingDirectory: "/tmp/worktree",
      model: "gpt-test",
      modelReasoningEffort: "high",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
    });
    expect(emitted).toEqual([
      { type: "tool-started", tool: "command", callId: "command-1" },
      { type: "tool-completed", tool: "command", ok: true, callId: "command-1" },
      { type: "text", text: "Hero is ready" },
    ]);
  });

  it("resumes the saved thread for repair turns", async () => {
    let resumedId: string | undefined;
    const client: CodexClient = {
      startThread() {
        throw new Error("Expected a resumed thread");
      },
      resumeThread(id) {
        resumedId = id;
        return {
          async runStreamed() {
            return { events: events() };
          },
        };
      },
    };
    const result = await new CodexAgentProvider({ client }).execute(
      { ...request(), sessionId: "thread-existing" },
      () => undefined,
    );

    expect(resumedId).toBe("thread-existing");
    expect(result.sessionId).toBe("thread-1");
  });
});
