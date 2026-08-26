import type { AgentExecutionRequest, AgentStreamEvent } from "@foundry/agent-runtime";
import type {
  ComponentBuildSpec,
  ProjectProfile,
  ReadyProjectFoundation,
} from "@foundry/contracts";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { ClaudeAgentProvider, type ClaudeQuery } from "../src/index.js";

function request(): AgentExecutionRequest {
  return {
    jobId: "run:hero",
    workingDirectory: "/tmp/worktree",
    prompt: "Build the hero",
    specification: {
      agent: { provider: "claude", model: "claude-test", reasoningEffort: "high" },
    } as ComponentBuildSpec,
    project: {} as ProjectProfile,
    foundation: {} as ReadyProjectFoundation,
  };
}

function message(value: unknown): SDKMessage {
  return value as SDKMessage;
}

describe("Claude provider", () => {
  it("normalizes SDK messages and configures non-interactive edits", async () => {
    let options: Options | undefined;
    const query: ClaudeQuery = async function* (input) {
      options = input.options;
      yield message({
        type: "assistant",
        session_id: "session-1",
        message: {
          content: [
            { type: "text", text: "Working" },
            { type: "tool_use", id: "tool-1", name: "Edit" },
          ],
        },
      });
      yield message({
        type: "user",
        session_id: "session-1",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tool-1", is_error: false }],
        },
      });
      yield message({
        type: "result",
        subtype: "success",
        session_id: "session-1",
        is_error: false,
        result: "Hero is ready",
      });
    };
    const provider = new ClaudeAgentProvider({ query });
    const emitted: AgentStreamEvent[] = [];
    const result = await provider.execute(request(), (event) => {
      emitted.push(event);
    });

    expect(result).toEqual({
      status: "completed",
      sessionId: "session-1",
      summary: "Hero is ready",
    });
    expect(options).toMatchObject({
      cwd: "/tmp/worktree",
      model: "claude-test",
      effort: "high",
      permissionMode: "acceptEdits",
      settingSources: ["project"],
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
      },
    });
    expect(emitted).toEqual([
      { type: "text", text: "Working" },
      { type: "tool-started", tool: "Edit", callId: "tool-1" },
      { type: "tool-completed", tool: "Edit", ok: true, callId: "tool-1" },
    ]);
  });
});
