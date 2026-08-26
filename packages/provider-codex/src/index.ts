import {
  AgentProviderError,
  type AgentEventSink,
  type AgentExecutionRequest,
  type AgentExecutionResult,
  type AgentProvider,
} from "@foundry/agent-runtime";
import {
  Codex,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type TurnOptions,
} from "@openai/codex-sdk";

export interface CodexClient {
  startThread(options?: ThreadOptions): {
    runStreamed(
      input: string,
      options?: TurnOptions,
    ): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
  };
  resumeThread(
    id: string,
    options?: ThreadOptions,
  ): {
    runStreamed(
      input: string,
      options?: TurnOptions,
    ): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
  };
}

export interface CodexAgentProviderOptions {
  readonly client?: CodexClient;
  readonly networkAccessEnabled?: boolean;
}

function toolName(item: ThreadItem): string | undefined {
  switch (item.type) {
    case "command_execution":
      return "command";
    case "file_change":
      return "file_change";
    case "mcp_tool_call":
      return `${item.server}.${item.tool}`;
    case "web_search":
      return "web_search";
    default:
      return undefined;
  }
}

async function emitItemStarted(item: ThreadItem, emit: AgentEventSink): Promise<void> {
  const tool = toolName(item);
  if (tool) await emit({ type: "tool-started", tool, callId: item.id });
}

async function emitItemCompleted(
  item: ThreadItem,
  emit: AgentEventSink,
): Promise<string | undefined> {
  if (item.type === "agent_message") {
    await emit({ type: "text", text: item.text });
    return item.text;
  }
  const tool = toolName(item);
  if (tool) {
    const ok =
      item.type === "command_execution"
        ? item.status === "completed"
        : item.type === "file_change" || item.type === "mcp_tool_call"
          ? item.status === "completed"
          : true;
    await emit({ type: "tool-completed", tool, ok, callId: item.id });
  }
  return undefined;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}

export class CodexAgentProvider implements AgentProvider {
  readonly name = "codex" as const;
  readonly capabilities = {
    streaming: true,
    sessions: true,
    toolEvents: true,
    cancellation: true,
  } as const;

  readonly #client: CodexClient;
  readonly #networkAccessEnabled: boolean;

  constructor(options: CodexAgentProviderOptions = {}) {
    this.#client = options.client ?? new Codex();
    this.#networkAccessEnabled = options.networkAccessEnabled ?? true;
  }

  async execute(
    request: AgentExecutionRequest,
    emit: AgentEventSink,
  ): Promise<AgentExecutionResult> {
    const threadOptions: ThreadOptions = {
      workingDirectory: request.workingDirectory,
      ...(request.specification.agent.model ? { model: request.specification.agent.model } : {}),
      ...(request.specification.agent.reasoningEffort
        ? { modelReasoningEffort: request.specification.agent.reasoningEffort }
        : {}),
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: this.#networkAccessEnabled,
    };
    const thread = request.sessionId
      ? this.#client.resumeThread(request.sessionId, threadOptions)
      : this.#client.startThread(threadOptions);

    let sessionId: string | undefined = request.sessionId;
    let summary: string | undefined;
    try {
      const { events } = await thread.runStreamed(request.prompt, {
        ...(request.signal ? { signal: request.signal } : {}),
      });
      for await (const event of events) {
        const terminal = await this.#handleEvent(event, emit);
        if (event.type === "thread.started") sessionId = event.thread_id;
        if (terminal) summary = terminal;
      }
    } catch (error) {
      if (isAbortError(error, request.signal)) {
        return {
          status: "cancelled",
          ...(sessionId ? { sessionId } : {}),
          ...(summary ? { summary } : {}),
        };
      }
      if (error instanceof AgentProviderError) throw error;
      throw new AgentProviderError({
        provider: this.name,
        code: "CODEX_EXECUTION_FAILED",
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

  async #handleEvent(event: ThreadEvent, emit: AgentEventSink): Promise<string | undefined> {
    switch (event.type) {
      case "item.started":
        await emitItemStarted(event.item, emit);
        return undefined;
      case "item.completed":
        return emitItemCompleted(event.item, emit);
      case "turn.failed":
        throw new AgentProviderError({
          provider: this.name,
          code: "CODEX_TURN_FAILED",
          message: event.error.message,
          retryable: true,
        });
      case "error":
        throw new AgentProviderError({
          provider: this.name,
          code: "CODEX_STREAM_FAILED",
          message: event.message,
          retryable: true,
        });
      default:
        return undefined;
    }
  }
}
