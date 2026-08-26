import {
  RunEventSchema,
  type RunEvent,
  type RunEventPayload,
  type RunId,
} from "@foundry/contracts";
import { redactSecrets } from "@foundry/security";

export type RunEventSink = (event: RunEvent) => void | Promise<void>;

export class RunEventPublisher {
  readonly #runId: RunId;
  readonly #sink: RunEventSink;
  readonly #clock: () => Date;
  #sequence = 0;
  #pending: Promise<void> = Promise.resolve();

  constructor(runId: RunId, sink: RunEventSink, clock: () => Date = () => new Date()) {
    this.#runId = runId;
    this.#sink = sink;
    this.#clock = clock;
  }

  emit(input: RunEventPayload): Promise<void> {
    const payload = redactSecrets(input);
    const sequence = this.#sequence;
    this.#sequence += 1;
    const event = RunEventSchema.parse({
      schemaVersion: 1,
      eventId: `${this.#runId}:${sequence}`,
      runId: this.#runId,
      sequence,
      occurredAt: this.#clock().toISOString(),
      payload,
    });
    this.#pending = this.#pending.then(async () => this.#sink(event));
    return this.#pending;
  }

  settled(): Promise<void> {
    return this.#pending;
  }
}
