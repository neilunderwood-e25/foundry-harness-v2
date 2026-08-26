import {
  AgentProviderError,
  type AgentEventSink,
  type AgentExecutionRequest,
  type AgentExecutionResult,
  type AgentProvider,
} from "@foundry/agent-runtime";
import {
  query as claudeQuery,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type ClaudeQuery = (input: {
  prompt: string;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

export interface ClaudeAgentProviderOptions {
  readonly query?: ClaudeQuery;
}

type ContentBlock = {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  id?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
};

function contentBlocks(message: SDKMessage): ContentBlock[] {
  if ((message.type !== "assistant" && message.type !== "user") || !("message" in message)) {
    return [];
  }
  const body: unknown = message.message;
  if (!body || typeof body !== "object" || !("content" in body)) return [];
  const content = (body as { content?: unknown }).content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

function abortControllerFor(signal?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller;
}

export class ClaudeAgentProvider implements AgentProvider {
  readonly name = "claude" as const;
  readonly capabilities = {
    streaming: true,
    sessions: true,
    toolEvents: true,
    cancellation: true,
  } as const;

  readonly #query: NonNullable<ClaudeAgentProviderOptions["query"]>;

  constructor(options: ClaudeAgentProviderOptions = {}) {
    this.#query = options.query ?? claudeQuery;
  }

  async execute(
    request: AgentExecutionRequest,
    emit: AgentEventSink,
  ): Promise<AgentExecutionResult> {
    const abortController = abortControllerFor(request.signal);
    const toolNames = new Map<string, string>();
    let sessionId: string | undefined;
    let summary: string | undefined;
    const options: Options = {
      cwd: request.workingDirectory,
      abortController,
      permissionMode: "acceptEdits",
      tools: { type: "preset", preset: "claude_code" },
      settingSources: ["project"],
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        filesystem: {
          allowRead: [request.workingDirectory],
          allowWrite: [request.workingDirectory],
        },
        network: {
          allowedDomains: ["figma.com", "www.figma.com", "api.figma.com"],
          strictAllowlist: true,
        },
      },
      ...(request.specification.agent.model ? { model: request.specification.agent.model } : {}),
      ...(request.specification.agent.reasoningEffort
        ? { effort: request.specification.agent.reasoningEffort }
        : {}),
      ...(request.sessionId ? { resume: request.sessionId } : {}),
    };

    try {
      for await (const message of this.#query({ prompt: request.prompt, options })) {
        if ("session_id" in message && typeof message.session_id === "string") {
          sessionId = message.session_id;
        }
        await this.#emitMessage(message, emit, toolNames);
        if (message.type === "result") {
          if (message.subtype !== "success" || message.is_error) {
            const detail = "errors" in message ? message.errors.join("; ") : message.subtype;
            throw new AgentProviderError({
              provider: this.name,
              code: `CLAUDE_${message.subtype.toUpperCase()}`,
              message: detail || "Claude execution failed",
              retryable: message.subtype === "error_during_execution",
            });
          }
          summary = message.result;
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        return {
          status: "cancelled",
          ...(sessionId ? { sessionId } : {}),
          ...(summary ? { summary } : {}),
        };
      }
      if (error instanceof AgentProviderError) throw error;
      throw new AgentProviderError({
        provider: this.name,
        code: "CLAUDE_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        cause: error,
      });
    }

    return {
      status: request.signal?.aborted ? "cancelled" : "completed",
      ...(sessionId ? { sessionId } : {}),
      ...(summary ? { summary } : {}),
    };
  }

  async #emitMessage(
    message: SDKMessage,
    emit: AgentEventSink,
    toolNames: Map<string, string>,
  ): Promise<void> {
    for (const block of contentBlocks(message)) {
      if (message.type === "assistant" && block.type === "text" && typeof block.text === "string") {
        await emit({ type: "text", text: block.text });
      }
      if (
        message.type === "assistant" &&
        block.type === "tool_use" &&
        typeof block.name === "string"
      ) {
        if (typeof block.id === "string") toolNames.set(block.id, block.name);
        await emit({
          type: "tool-started",
          tool: block.name,
          ...(typeof block.id === "string" ? { callId: block.id } : {}),
        });
      }
      if (message.type === "user" && block.type === "tool_result") {
        const callId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
        await emit({
          type: "tool-completed",
          tool: (callId && toolNames.get(callId)) ?? "tool",
          ok: block.is_error !== true,
          ...(callId ? { callId } : {}),
        });
      }
    }
  }
}
