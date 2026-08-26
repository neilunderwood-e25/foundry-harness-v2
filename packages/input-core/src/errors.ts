export class InputPreparationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(input: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: Readonly<Record<string, unknown>>;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "InputPreparationError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}
