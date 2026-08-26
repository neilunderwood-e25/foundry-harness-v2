import {
  BatchDeliveryRequestSchema,
  RunCancellationSchema,
  type BatchDeliveryRequest,
  type BatchDeliveryResult,
  type DurableRun,
  type DurableRunSnapshot,
  type RunCancellation,
  type RunEvent,
  type RunEventPayload,
  type RunId,
} from "@foundry/contracts";
import type { RunEventSink } from "./events.js";

export interface DurableDeliveryRunner {
  deliver(
    request: BatchDeliveryRequest,
    options: { onEvent: RunEventSink; signal: AbortSignal },
  ): Promise<BatchDeliveryResult>;
}

export interface DurableRunRepository {
  createDeliveryRun(request: BatchDeliveryRequest): DurableRun;
  getRun(runId: RunId | string): DurableRun | undefined;
  requireRun(runId: RunId | string): DurableRun;
  listRuns(options?: { limit?: number; projectId?: string }): DurableRun[];
  appendEvent(event: RunEvent): RunEvent;
  appendSystemEvent(runId: RunId | string, payload: RunEventPayload): RunEvent;
  listEvents(runId: RunId | string, afterSequence?: number): RunEvent[];
  requestCancellation(runId: RunId | string): { accepted: boolean; run: DurableRun };
  failRun(runId: RunId | string, code: string, message: string): DurableRun;
  recordDeliveryResult(result: BatchDeliveryResult): DurableRun;
  recoverInterruptedRuns(reason?: string): DurableRun[];
  getSnapshot(runId: RunId | string): DurableRunSnapshot | undefined;
  close(): void;
}

export interface DurableRunCoordinatorOptions {
  readonly repository: DurableRunRepository;
  readonly deliveryRunnerFactory: () => DurableDeliveryRunner;
}

type RunEventListener = (event: RunEvent) => void;

function failure(error: unknown): { code: string; message: string } {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return {
      code: error.code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    code: "DURABLE_RUN_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

export class DurableRunCoordinator {
  readonly #repository: DurableRunRepository;
  readonly #deliveryRunnerFactory: () => DurableDeliveryRunner;
  readonly #controllers = new Map<string, AbortController>();
  readonly #tasks = new Map<string, Promise<void>>();
  readonly #listeners = new Map<string, Set<RunEventListener>>();
  #closing = false;

  constructor(options: DurableRunCoordinatorOptions) {
    this.#repository = options.repository;
    this.#deliveryRunnerFactory = options.deliveryRunnerFactory;
  }

  recoverInterruptedRuns(): DurableRun[] {
    return this.#repository.recoverInterruptedRuns();
  }

  startDelivery(input: BatchDeliveryRequest): DurableRun {
    if (this.#closing) throw new Error("The durable run coordinator is shutting down");
    const request = BatchDeliveryRequestSchema.parse(input);
    const run = this.#repository.createDeliveryRun(request);
    const controller = new AbortController();
    this.#controllers.set(run.runId, controller);
    const task = this.#execute(request, controller).finally(() => {
      this.#controllers.delete(run.runId);
      this.#tasks.delete(run.runId);
    });
    this.#tasks.set(run.runId, task);
    return run;
  }

  getRun(runId: RunId | string): DurableRun | undefined {
    return this.#repository.getRun(runId);
  }

  getSnapshot(runId: RunId | string): DurableRunSnapshot | undefined {
    return this.#repository.getSnapshot(runId);
  }

  listRuns(options: { limit?: number; projectId?: string } = {}): DurableRun[] {
    return this.#repository.listRuns(options);
  }

  listEvents(runId: RunId | string, afterSequence = -1): RunEvent[] {
    this.#repository.requireRun(runId);
    return this.#repository.listEvents(runId, afterSequence);
  }

  cancel(runId: RunId | string): RunCancellation {
    const { accepted, run } = this.#repository.requestCancellation(runId);
    if (accepted) this.#controllers.get(run.runId)?.abort("Cancellation requested");
    return RunCancellationSchema.parse({
      runId: run.runId,
      accepted,
      status: run.status,
      message: accepted
        ? "Cancellation was requested"
        : `Run is already ${run.status} and cannot be cancelled`,
    });
  }

  subscribe(runId: RunId | string, afterSequence: number, listener: RunEventListener): () => void {
    this.#repository.requireRun(runId);
    const key = String(runId);
    let deliveredSequence = afterSequence;
    const liveListener: RunEventListener = (event) => {
      if (event.sequence <= deliveredSequence) return;
      deliveredSequence = event.sequence;
      listener(event);
    };
    const listeners = this.#listeners.get(key) ?? new Set<RunEventListener>();
    listeners.add(liveListener);
    this.#listeners.set(key, listeners);
    for (const event of this.#repository.listEvents(runId, afterSequence)) liveListener(event);
    return () => {
      const current = this.#listeners.get(key);
      current?.delete(liveListener);
      if (current?.size === 0) this.#listeners.delete(key);
    };
  }

  async waitForRun(runId: RunId | string): Promise<DurableRun> {
    await this.#tasks.get(String(runId));
    return this.#repository.requireRun(runId);
  }

  async close(): Promise<void> {
    this.#closing = true;
    for (const controller of this.#controllers.values())
      controller.abort("Foundry is shutting down");
    await Promise.allSettled(this.#tasks.values());
    this.#listeners.clear();
    this.#repository.close();
  }

  async #execute(request: BatchDeliveryRequest, controller: AbortController): Promise<void> {
    try {
      const result = await this.#deliveryRunnerFactory().deliver(request, {
        signal: controller.signal,
        onEvent: async (event) => {
          this.#repository.appendEvent(event);
          this.#publish(event);
        },
      });
      this.#repository.recordDeliveryResult(result);
    } catch (error) {
      const details = failure(error);
      const event = this.#repository.appendSystemEvent(request.batch.runId, {
        type: "run.completed",
        status: "failed",
      });
      this.#repository.failRun(request.batch.runId, details.code, details.message);
      this.#publish(event);
    }
  }

  #publish(event: RunEvent): void {
    for (const listener of this.#listeners.get(event.runId) ?? []) {
      try {
        listener(event);
      } catch {
        // A disconnected observer must never affect the durable run.
      }
    }
  }
}
