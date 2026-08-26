import type {
  AgentProviderCapabilities,
  AgentProviderName,
  ComponentBuildSpec,
  ProjectProfile,
  ReadyProjectFoundation,
} from "@foundry/contracts";

export type AgentStreamEvent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool-started";
      readonly tool: string;
      readonly callId?: string;
    }
  | {
      readonly type: "tool-completed";
      readonly tool: string;
      readonly ok: boolean;
      readonly callId?: string;
    };

export interface AgentExecutionRequest {
  readonly jobId: string;
  readonly workingDirectory: string;
  readonly prompt: string;
  readonly specification: ComponentBuildSpec;
  readonly project: ProjectProfile;
  readonly foundation: ReadyProjectFoundation;
  readonly sessionId?: string;
  readonly additionalReadDirectories?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface AgentExecutionResult {
  readonly status: "completed" | "cancelled";
  readonly sessionId?: string;
  readonly summary?: string;
}

export type AgentEventSink = (event: AgentStreamEvent) => void | Promise<void>;

export interface AgentProvider {
  readonly name: AgentProviderName;
  readonly capabilities: AgentProviderCapabilities;
  execute(request: AgentExecutionRequest, emit: AgentEventSink): Promise<AgentExecutionResult>;
}
