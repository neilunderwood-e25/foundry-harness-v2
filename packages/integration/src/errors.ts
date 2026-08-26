export class IntegrationError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  override readonly cause?: unknown;

  constructor(options: {
    code: string;
    message: string;
    details?: Readonly<Record<string, unknown>>;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "IntegrationError";
    this.code = options.code;
    this.details = options.details ?? {};
    if (options.cause !== undefined) this.cause = options.cause;
  }
}
