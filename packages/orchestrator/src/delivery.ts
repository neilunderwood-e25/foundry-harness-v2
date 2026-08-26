import {
  AgentProviderError,
  buildRepairPrompt,
  type AgentProviderRegistry,
  type AgentStreamEvent,
} from "@foundry/agent-runtime";
import {
  BatchDeliveryRequestSchema,
  BatchDeliveryResultSchema,
  type BatchDeliveryRequest,
  type BatchDeliveryResult,
  type BatchExecutionResult,
  type ChangedFile,
  type DeliveredComponent,
  type DeliveryComponentResult,
  type IntegrationResult,
  type RunEventPayload,
  type VerificationReport,
  type WorktreeHandle,
} from "@foundry/contracts";
import { planBatchJobs } from "@foundry/domain";
import { GitBatchIntegrator, IntegrationError } from "@foundry/integration";
import { ComponentVerifier, toProjectPath } from "@foundry/verifier";
import { RunEventPublisher, type RunEventSink } from "./events.js";
import { BatchExecutor, type ExecuteBatchOptions } from "./executor.js";

export interface GenerationExecutor {
  execute(
    request: BatchDeliveryRequest,
    options?: ExecuteBatchOptions,
  ): Promise<BatchExecutionResult>;
}

export interface DeliveryVerifier {
  verify(input: {
    request: BatchDeliveryRequest;
    specification: BatchDeliveryRequest["batch"]["components"][number];
    worktree: WorktreeHandle;
    changedFiles: readonly ChangedFile[];
    attempt: number;
  }): Promise<VerificationReport>;
}

export interface DeliveryIntegrator {
  changedFiles(worktree: WorktreeHandle): Promise<ChangedFile[]>;
  commitComponent(
    worktree: WorktreeHandle,
    changedFiles: readonly ChangedFile[],
    message: string,
  ): Promise<string>;
  integrate(
    request: BatchDeliveryRequest,
    components: readonly DeliveredComponent[],
  ): Promise<IntegrationResult>;
}

export interface BatchDeliveryPipelineOptions {
  readonly providers: AgentProviderRegistry;
  readonly executor?: GenerationExecutor;
  readonly verifier?: DeliveryVerifier;
  readonly integrator?: DeliveryIntegrator;
  readonly clock?: () => Date;
}

export interface DeliverBatchOptions {
  readonly onEvent?: RunEventSink;
  readonly signal?: AbortSignal;
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof AgentProviderError || error instanceof IntegrationError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "DELIVERY_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function ownedAfterVerification(
  request: BatchDeliveryRequest,
  slug: string,
  worktree: WorktreeHandle,
  changedFiles: readonly ChangedFile[],
): boolean {
  const root = `${request.project.paths.sectionRoot}/${slug}`;
  return changedFiles.every(({ path }) => {
    const projectPath = toProjectPath(worktree, path);
    return projectPath === root || projectPath.startsWith(`${root}/`);
  });
}

export class BatchDeliveryPipeline {
  readonly #providers: AgentProviderRegistry;
  readonly #executor: GenerationExecutor;
  readonly #verifier: DeliveryVerifier;
  readonly #integrator: DeliveryIntegrator;
  readonly #clock: () => Date;

  constructor(options: BatchDeliveryPipelineOptions) {
    this.#providers = options.providers;
    this.#executor = options.executor ?? new BatchExecutor({ providers: options.providers });
    this.#verifier = options.verifier ?? new ComponentVerifier();
    this.#integrator = options.integrator ?? new GitBatchIntegrator();
    this.#clock = options.clock ?? (() => new Date());
  }

  async deliver(
    input: BatchDeliveryRequest,
    options: DeliverBatchOptions = {},
  ): Promise<BatchDeliveryResult> {
    const request = BatchDeliveryRequestSchema.parse(input);
    const startedAt = this.#clock().toISOString();
    const publisher = new RunEventPublisher(
      request.batch.runId,
      options.onEvent ?? (() => undefined),
      this.#clock,
    );

    const execution = await this.#executor.execute(request, {
      ...(options.signal ? { signal: options.signal } : {}),
      onEvent: async (event) => {
        if (
          event.payload.type !== "run.completed" &&
          event.payload.type !== "run.cancelled" &&
          event.payload.type !== "job.completed"
        ) {
          await publisher.emit(event.payload);
        }
      },
    });
    const results = new Array<DeliveryComponentResult | undefined>(execution.jobs.length);
    let cursor = 0;
    const jobsById = new Map(planBatchJobs(request.batch).map((job) => [job.componentId, job]));

    const worker = async (): Promise<void> => {
      while (cursor < execution.jobs.length) {
        const index = cursor;
        cursor += 1;
        const executionJob = execution.jobs[index];
        if (!executionJob) return;
        if (executionJob.status === "failed") {
          results[index] = {
            status: "failed",
            jobId: executionJob.jobId,
            componentId: executionJob.componentId,
            ...(executionJob.worktree ? { worktree: executionJob.worktree } : {}),
            reports: [],
            code: executionJob.code,
            message: executionJob.message,
          };
          continue;
        }
        if (executionJob.status === "cancelled") {
          results[index] = {
            status: "cancelled",
            jobId: executionJob.jobId,
            componentId: executionJob.componentId,
            ...(executionJob.worktree ? { worktree: executionJob.worktree } : {}),
            reports: [],
            message: executionJob.message,
          };
          continue;
        }
        const job = jobsById.get(executionJob.componentId);
        if (!job) throw new Error(`Missing job plan for ${executionJob.componentId}`);
        const delivered = await this.#verifyRepairAndCommit(
          request,
          executionJob,
          job.specification,
          publisher,
          options.signal,
        );
        results[index] = delivered;
        if (delivered.status === "passed") {
          await publisher.emit({
            type: "job.completed",
            jobId: delivered.jobId,
            componentId: delivered.componentId,
          });
        } else if (delivered.status === "cancelled") {
          await publisher.emit({
            type: "job.cancelled",
            jobId: delivered.jobId,
            componentId: delivered.componentId,
            reason: delivered.message,
          });
        } else {
          await publisher.emit({
            type: "job.failed",
            jobId: delivered.jobId,
            code: delivered.code,
            message: delivered.message,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(request.batch.maxParallel, execution.jobs.length) }, worker),
    );

    const settled = results.filter(
      (result): result is DeliveryComponentResult => result !== undefined,
    );
    const passed = settled.filter(
      (result): result is DeliveredComponent => result.status === "passed",
    );
    let status: BatchDeliveryResult["status"];
    let integration: IntegrationResult | undefined;
    let failure: { code: string; message: string } | undefined;

    if (settled.length > 0 && settled.every(({ status: jobStatus }) => jobStatus === "cancelled")) {
      status = "cancelled";
    } else if (passed.length !== request.batch.components.length) {
      status = passed.length > 0 ? "partial" : "failed";
    } else {
      await publisher.emit({ type: "phase.started", phase: "integration" });
      try {
        integration = await this.#integrator.integrate(request, passed);
        status = integration.status === "passed" ? "passed" : "failed";
        if (integration.status === "failed") {
          failure = {
            code: integration.code ?? "INTEGRATION_FAILED",
            message: integration.message ?? "Integration failed",
          };
        }
      } catch (error) {
        status = "failed";
        failure = errorDetails(error);
      }
      await publisher.emit({ type: "phase.completed", phase: "integration" });
    }

    if (status === "cancelled") {
      await publisher.emit({ type: "run.cancelled", reason: "Delivery was cancelled" });
    } else {
      await publisher.emit({ type: "run.completed", status });
    }
    await publisher.settled();

    return BatchDeliveryResultSchema.parse({
      schemaVersion: 1,
      runId: request.batch.runId,
      status,
      startedAt,
      completedAt: this.#clock().toISOString(),
      jobs: settled,
      ...(integration ? { integration } : {}),
      ...(failure ? failure : {}),
    });
  }

  async #verifyRepairAndCommit(
    request: BatchDeliveryRequest,
    executionJob: Extract<BatchExecutionResult["jobs"][number], { status: "completed" }>,
    specification: BatchDeliveryRequest["batch"]["components"][number],
    publisher: RunEventPublisher,
    signal?: AbortSignal,
  ): Promise<DeliveryComponentResult> {
    const reports: VerificationReport[] = [];
    let sessionId = executionJob.sessionId;
    const provider = this.#providers.resolve(specification.agent.provider);
    const componentRoot = `${request.project.paths.sectionRoot}/${specification.slug}`;

    try {
      for (let attempt = 1; attempt <= specification.agent.maxRepairTurns + 1; attempt += 1) {
        if (signal?.aborted) {
          return {
            status: "cancelled",
            jobId: executionJob.jobId,
            componentId: executionJob.componentId,
            worktree: executionJob.worktree,
            reports,
            message: "Delivery was cancelled during verification",
          };
        }
        const changedFiles = await this.#integrator.changedFiles(executionJob.worktree);
        await publisher.emit({
          type: "phase.started",
          jobId: executionJob.jobId,
          phase: `verification:${attempt}`,
        });
        const report = await this.#verifier.verify({
          request,
          specification,
          worktree: executionJob.worktree,
          changedFiles,
          attempt,
        });
        reports.push(report);
        await publisher.emit({
          type: "verification.completed",
          jobId: executionJob.jobId,
          verdict: report.verdict,
        });
        await publisher.emit({
          type: "phase.completed",
          jobId: executionJob.jobId,
          phase: `verification:${attempt}`,
        });

        if (report.verdict === "passed") {
          const finalChanges = await this.#integrator.changedFiles(executionJob.worktree);
          if (
            !ownedAfterVerification(
              request,
              specification.slug,
              executionJob.worktree,
              finalChanges,
            )
          ) {
            throw new IntegrationError({
              code: "POST_VERIFICATION_SCOPE_CHANGE",
              message: "Verification commands changed files outside the component scope",
            });
          }
          await publisher.emit({
            type: "phase.started",
            jobId: executionJob.jobId,
            phase: "commit",
          });
          const commit = await this.#integrator.commitComponent(
            executionJob.worktree,
            finalChanges,
            `feat(foundry): add ${specification.name}`,
          );
          await publisher.emit({
            type: "phase.completed",
            jobId: executionJob.jobId,
            phase: "commit",
          });
          return {
            status: "passed",
            jobId: executionJob.jobId,
            componentId: executionJob.componentId,
            worktree: executionJob.worktree,
            changedFiles: finalChanges,
            reports,
            commit,
            ...(sessionId ? { sessionId } : {}),
          };
        }

        if (attempt > specification.agent.maxRepairTurns) break;
        await publisher.emit({
          type: "phase.started",
          jobId: executionJob.jobId,
          phase: `repair:${attempt}`,
        });
        const repair = await provider.execute(
          {
            jobId: executionJob.jobId,
            workingDirectory: executionJob.worktree.workingDirectory,
            prompt: buildRepairPrompt(report, componentRoot),
            specification,
            project: request.project,
            foundation: request.foundation,
            ...(sessionId ? { sessionId } : {}),
            ...(signal ? { signal } : {}),
          },
          async (event) => this.#publishAgentEvent(publisher, executionJob.jobId, event),
        );
        sessionId = repair.sessionId ?? sessionId;
        await publisher.emit({
          type: "phase.completed",
          jobId: executionJob.jobId,
          phase: `repair:${attempt}`,
        });
        if (repair.status === "cancelled") {
          return {
            status: "cancelled",
            jobId: executionJob.jobId,
            componentId: executionJob.componentId,
            worktree: executionJob.worktree,
            reports,
            message: "Agent repair was cancelled",
          };
        }
      }

      return {
        status: "failed",
        jobId: executionJob.jobId,
        componentId: executionJob.componentId,
        worktree: executionJob.worktree,
        reports,
        code: "VERIFICATION_FAILED",
        message: `Component failed verification after ${reports.length} attempt(s)`,
      };
    } catch (error) {
      return {
        status: "failed",
        jobId: executionJob.jobId,
        componentId: executionJob.componentId,
        worktree: executionJob.worktree,
        reports,
        ...errorDetails(error),
      };
    }
  }

  async #publishAgentEvent(
    publisher: RunEventPublisher,
    jobId: BatchExecutionResult["jobs"][number]["jobId"],
    event: AgentStreamEvent,
  ): Promise<void> {
    let payload: RunEventPayload;
    switch (event.type) {
      case "text":
        payload = { type: "agent.text", jobId, text: event.text };
        break;
      case "tool-started":
        payload = { type: "agent.tool.started", jobId, tool: event.tool };
        break;
      case "tool-completed":
        payload = { type: "agent.tool.completed", jobId, tool: event.tool, ok: event.ok };
        break;
    }
    await publisher.emit(payload);
  }
}
