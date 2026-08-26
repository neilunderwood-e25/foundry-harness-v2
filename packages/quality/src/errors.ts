export class QualityError extends Error {
  readonly code: string;
  readonly repairable: boolean;
  override readonly cause?: unknown;

  constructor(options: { code: string; message: string; repairable?: boolean; cause?: unknown }) {
    super(options.message);
    this.name = "QualityError";
    this.code = options.code;
    this.repairable = options.repairable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}
