export class AgentProviderError extends Error {
  readonly provider: string;
  readonly code: string;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(options: {
    provider: string;
    code: string;
    message: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "AgentProviderError";
    this.provider = options.provider;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}
