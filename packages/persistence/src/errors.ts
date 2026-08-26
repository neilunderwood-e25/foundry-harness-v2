export class PersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}
