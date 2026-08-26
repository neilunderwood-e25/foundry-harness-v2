import { dirname, relative, sep } from "node:path";
import {
  AgentProviderError,
  buildComponentPrompt,
  type AgentProviderRegistry,
  type AgentStreamEvent,
} from "@foundry/agent-runtime";
import {
  BatchExecutionRequestSchema,
  BatchExecutionResultSchema,
  JobIdSchema,
  type BatchExecutionRequest,
  type BatchExecutionResult,
  type ChangedFile,
  type ComponentJobResult,
  type WorktreeHandle,
} from "@foundry/contracts";
import { planBatchJobs, type ComponentJobPlan, DomainError } from "@foundry/domain";
import { GitWorktreeManager, WorktreeError } from "@foundry/worktrees";
import { RunEventPublisher, type RunEventSink } from "./events.js";
import { assertBatchExecutionReady } from "./validation.js";

export interface BatchExecutorOptions {
  readonly providers: AgentProviderRegistry;
  readonly clock?: () => Date;
  readonly worktreeManagerFactory?: (request: BatchExecutionRequest) => WorktreeService;
}

export interface WorktreeService {
  prepare(job: ComponentJobPlan): Promise<WorktreeHandle>;
  changedFiles(worktree: WorktreeHandle): Promise<ChangedFile[]>;
}

export interface ExecuteBatchOptions {
  readonly onEvent?: RunEventSink;
  readonly signal?: AbortSignal;
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (
    error instanceof AgentProviderError ||
    error instanceof WorktreeError ||
    error instanceof DomainError
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "JOB_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function toProjectPath(worktree: WorktreeHandle, path: string): string {
  const subdirectory = relative(worktree.checkoutDir, worktree.workingDirectory);
  const normalized = path.split(sep).join("/");
  if (!subdirectory) return normalized;
  const prefix = `${subdirectory.split(sep).join("/")}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : `../${normalized}`;
}

function assertChangedFilesOwned(
  worktree: WorktreeHandle,
  job: ComponentJobPlan,
  sectionRoot: string,
  changedFiles: readonly ChangedFile[],
): void {
  const expectedRoot = `${sectionRoot}/${job.slug}`;
  const outside = changedFiles
    .map((file) => toProjectPath(worktree, file.path))
    .filter((path) => path !== expectedRoot && !path.startsWith(`${expectedRoot}/`));
  if (outside.length > 0) {
    throw new DomainError("OUT_OF_SCOPE_CHANGES", "Agent changed files outside component scope", {
      expectedRoot,
      outside,
    });
  }
}

function runStatus(results: readonly ComponentJobResult[], aborted: boolean) {
  if (aborted && results.every(({ status }) => status === "cancelled")) return "cancelled" as const;
  const completed = results.filter(({ status }) => status === "completed").length;
  if (completed === results.length) return "completed" as const;
  if (completed === 0) return aborted ? ("cancelled" as const) : ("failed" as const);
  return "partial" as const;
}

export class BatchExecutor {
  readonly #providers: AgentProviderRegistry;
  readonly #clock: () => Date;
  readonly #worktreeManagerFactory: (request: BatchExecutionRequest) => WorktreeService;

  constructor(options: BatchExecutorOptions) {
    this.#providers = options.providers;
    this.#clock = options.clock ?? (() => new Date());
    this.#worktreeManagerFactory =
      options.worktreeManagerFactory ??
      ((request) =>
        new GitWorktreeManager({
          projectRoot: request.project.rootDir,
          worktreeRoot: request.worktreeRoot,
        }));
  }

  async execute(
    input: BatchExecutionRequest,
    options: ExecuteBatchOptions = {},
  ): Promise<BatchExecutionResult> {
    const request = BatchExecutionRequestSchema.parse(input);
    assertBatchExecutionReady(request);
    const startedAt = this.#clock().toISOString();
    const publisher = new RunEventPublisher(
      request.batch.runId,
      options.onEvent ?? (() => undefined),
      this.#clock,
    );
    const manager = this.#worktreeManagerFactory(request);
    const jobs = planBatchJobs(request.batch);
    const results = new Array<ComponentJobResult | undefined>(jobs.length);
    let cursor = 0;

    await publisher.emit({ type: "run.started" });
    for (const job of jobs) {
      await publisher.emit({
        type: "job.queued",
        jobId: JobIdSchema.parse(`${job.runId}:${job.componentId}`),
        componentId: job.specification.componentId,
      });
    }

    const worker = async (): Promise<void> => {
      while (cursor < jobs.length) {
        const index = cursor;
        cursor += 1;
        const job = jobs[index];
        if (!job) return;
        results[index] = await this.#executeJob(request, manager, job, publisher, options.signal);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(request.batch.maxParallel, jobs.length) }, worker),
    );

    const settledResults = results.filter(
      (result): result is ComponentJobResult => result !== undefined,
    );
    const status = runStatus(settledResults, options.signal?.aborted ?? false);
    if (status === "cancelled") {
      await publisher.emit({ type: "run.cancelled", reason: "Execution was cancelled" });
    } else {
      await publisher.emit({ type: "run.completed", status });
    }
    await publisher.settled();

    return BatchExecutionResultSchema.parse({
      schemaVersion: 1,
      runId: request.batch.runId,
      status,
      startedAt,
      completedAt: this.#clock().toISOString(),
      jobs: settledResults,
    });
  }

  async #executeJob(
    request: BatchExecutionRequest,
    manager: WorktreeService,
    job: ComponentJobPlan,
    publisher: RunEventPublisher,
    signal?: AbortSignal,
  ): Promise<ComponentJobResult> {
    const jobId = JobIdSchema.parse(`${job.runId}:${job.componentId}`);
    const providerName = job.specification.agent.provider;
    let worktree: WorktreeHandle | undefined;
    if (signal?.aborted) {
      await publisher.emit({
        type: "job.cancelled",
        jobId,
        componentId: job.specification.componentId,
        reason: "Execution was cancelled before the job started",
      });
      return {
        status: "cancelled",
        jobId,
        componentId: job.specification.componentId,
        provider: providerName,
        message: "Execution was cancelled before the job started",
      };
    }

    await publisher.emit({
      type: "job.started",
      jobId,
      componentId: job.specification.componentId,
    });
    try {
      await publisher.emit({ type: "phase.started", jobId, phase: "worktree" });
      worktree = await manager.prepare(job);
      await publisher.emit({ type: "phase.completed", jobId, phase: "worktree" });

      const provider = this.#providers.resolve(providerName);
      const preparedInput = request.preparedInputs?.[job.specification.componentId];
      await publisher.emit({ type: "phase.started", jobId, phase: "agent" });
      const execution = await provider.execute(
        {
          jobId,
          workingDirectory: worktree.workingDirectory,
          prompt: buildComponentPrompt({
            specification: job.specification,
            project: request.project,
            foundation: request.foundation,
            ...(preparedInput ? { preparedInput } : {}),
          }),
          specification: job.specification,
          project: request.project,
          foundation: request.foundation,
          ...(preparedInput ? { preparedInput } : {}),
          ...(preparedInput
            ? {
                additionalReadDirectories: [
                  ...new Set(preparedInput.artifacts.map(({ path }) => dirname(path))),
                ],
              }
            : {}),
          ...(signal ? { signal } : {}),
        },
        async (event) => this.#publishAgentEvent(publisher, jobId, event),
      );
      await publisher.emit({ type: "phase.completed", jobId, phase: "agent" });

      if (execution.status === "cancelled") {
        await publisher.emit({
          type: "job.cancelled",
          jobId,
          componentId: job.specification.componentId,
          reason: "Agent execution was cancelled",
        });
        return {
          status: "cancelled",
          jobId,
          componentId: job.specification.componentId,
          provider: providerName,
          worktree,
          message: "Agent execution was cancelled",
        };
      }

      const changedFiles = await manager.changedFiles(worktree);
      assertChangedFilesOwned(worktree, job, request.project.paths.sectionRoot, changedFiles);
      await publisher.emit({
        type: "job.completed",
        jobId,
        componentId: job.specification.componentId,
      });
      return {
        status: "completed",
        jobId,
        componentId: job.specification.componentId,
        provider: providerName,
        worktree,
        changedFiles,
        ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
        ...(execution.summary ? { summary: execution.summary } : {}),
      };
    } catch (error) {
      const failure = errorDetails(error);
      await publisher.emit({ type: "job.failed", jobId, ...failure });
      return {
        status: "failed",
        jobId,
        componentId: job.specification.componentId,
        provider: providerName,
        ...(worktree ? { worktree } : {}),
        ...failure,
      };
    }
  }

  async #publishAgentEvent(
    publisher: RunEventPublisher,
    jobId: ReturnType<typeof JobIdSchema.parse>,
    event: AgentStreamEvent,
  ): Promise<void> {
    switch (event.type) {
      case "text":
        await publisher.emit({ type: "agent.text", jobId, text: event.text });
        break;
      case "tool-started":
        await publisher.emit({ type: "agent.tool.started", jobId, tool: event.tool });
        break;
      case "tool-completed":
        await publisher.emit({
          type: "agent.tool.completed",
          jobId,
          tool: event.tool,
          ok: event.ok,
        });
        break;
    }
  }
}
