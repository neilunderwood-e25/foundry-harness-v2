import {
  ArtifactRefSchema,
  BatchDeliveryRequestSchema,
  BatchDeliveryResultSchema,
  DurableJobSchema,
  DurableRunSchema,
  DurableRunSnapshotSchema,
  ProjectFoundationSchema,
  ProjectProfileSchema,
  RegisteredProjectSchema,
  RunEventSchema,
  VerificationReportSchema,
  WorkflowStepSchema,
  type ArtifactRef,
  type BatchDeliveryRequest,
  type BatchDeliveryResult,
  type DurableJob,
  type DurableRun,
  type DurableRunSnapshot,
  type ProjectFoundation,
  type ProjectProfile,
  type RegisteredProject,
  type RunEvent,
  type RunEventPayload,
  type RunId,
  type VerificationReport,
  type WorkflowStep,
} from "@foundry/contracts";
import { redactSecrets, redactText } from "@foundry/security";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type * as NodeSqlite from "node:sqlite";
import { PersistenceError } from "./errors.js";
import { migrate } from "./migrations.js";
import {
  agentSessions,
  artifacts,
  integrationAttempts,
  jobs,
  projects,
  runEvents,
  runs,
  verificationReports,
  workflowSteps,
  worktrees,
} from "./schema.js";

type SqliteDatabase = ReturnType<typeof drizzle>;
type SqliteTransaction = Parameters<Parameters<SqliteDatabase["transaction"]>[0]>[0];
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof NodeSqlite;

const terminalStatuses = new Set([
  "completed",
  "passed",
  "failed",
  "partial",
  "cancelled",
  "interrupted",
]);

export interface SqliteRunStoreOptions {
  readonly databasePath: string;
  readonly clock?: () => Date;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function optionalJson(value: string | null): unknown | undefined {
  return value === null ? undefined : JSON.parse(value);
}

function errorChain(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  const seen = new Set<unknown>();
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    messages.push(current instanceof Error ? current.message : String(current));
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return messages.join(" ");
}

function runFromRow(row: typeof runs.$inferSelect): DurableRun {
  return DurableRunSchema.parse({
    schemaVersion: 1,
    runId: row.runId,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    cancelRequested: row.cancelRequested,
    request: JSON.parse(row.requestJson),
    result: optionalJson(row.resultJson),
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    updatedAt: row.updatedAt,
  });
}

function projectFromRow(row: typeof projects.$inferSelect): RegisteredProject {
  return RegisteredProjectSchema.parse({
    schemaVersion: 1,
    projectId: row.projectId,
    rootDir: row.rootDir,
    profile: JSON.parse(row.profileJson),
    foundation: JSON.parse(row.foundationJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function eventJobId(payload: RunEventPayload): string | null {
  return "jobId" in payload ? (payload.jobId ?? null) : null;
}

export class SqliteRunStore {
  readonly #sqlite: NodeSqlite.DatabaseSync;
  readonly #db: SqliteDatabase;
  readonly #clock: () => Date;
  #closed = false;

  constructor(options: SqliteRunStoreOptions) {
    this.#clock = options.clock ?? (() => new Date());
    if (options.databasePath !== ":memory:")
      mkdirSync(dirname(options.databasePath), { recursive: true });
    this.#sqlite = new DatabaseSync(options.databasePath);
    this.#sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (options.databasePath !== ":memory:") this.#sqlite.exec("PRAGMA journal_mode = WAL;");
    migrate(this.#sqlite, this.#clock);
    this.#db = drizzle({ client: this.#sqlite });
  }

  saveProject(profileInput: ProjectProfile, foundationInput: ProjectFoundation): RegisteredProject {
    const profile = ProjectProfileSchema.parse(profileInput);
    const foundation = ProjectFoundationSchema.parse(foundationInput);
    if (profile.projectId !== foundation.projectId) {
      throw new PersistenceError(
        "PROJECT_ID_MISMATCH",
        `Profile ${profile.projectId} does not match foundation ${foundation.projectId}`,
      );
    }
    const now = this.#clock().toISOString();
    this.#db
      .insert(projects)
      .values({
        projectId: profile.projectId,
        rootDir: profile.rootDir,
        profileJson: json(profile),
        foundationJson: json(foundation),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projects.projectId,
        set: {
          rootDir: profile.rootDir,
          profileJson: json(profile),
          foundationJson: json(foundation),
          updatedAt: now,
        },
      })
      .run();
    return this.requireProject(profile.projectId);
  }

  getProject(projectId: string): RegisteredProject | undefined {
    const row = this.#db.select().from(projects).where(eq(projects.projectId, projectId)).get();
    return row ? projectFromRow(row) : undefined;
  }

  requireProject(projectId: string): RegisteredProject {
    const project = this.getProject(projectId);
    if (!project) {
      throw new PersistenceError("PROJECT_NOT_FOUND", `Project ${projectId} was not found`);
    }
    return project;
  }

  listProjects(options: { limit?: number } = {}): RegisteredProject[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
    return this.#db
      .select()
      .from(projects)
      .orderBy(desc(projects.updatedAt))
      .limit(limit)
      .all()
      .map(projectFromRow);
  }

  createDeliveryRun(input: BatchDeliveryRequest): DurableRun {
    const request = BatchDeliveryRequestSchema.parse(redactSecrets(input));
    if (this.getRun(request.batch.runId)) {
      throw new PersistenceError("RUN_ALREADY_EXISTS", `Run ${request.batch.runId} already exists`);
    }
    const now = this.#clock().toISOString();
    try {
      this.#db.transaction((transaction) => {
        transaction
          .insert(projects)
          .values({
            projectId: request.project.projectId,
            rootDir: request.project.rootDir,
            profileJson: json(request.project),
            foundationJson: json(request.foundation),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: projects.projectId,
            set: {
              rootDir: request.project.rootDir,
              profileJson: json(request.project),
              foundationJson: json(request.foundation),
              updatedAt: now,
            },
          })
          .run();
        transaction
          .insert(runs)
          .values({
            runId: request.batch.runId,
            projectId: request.project.projectId,
            kind: "delivery",
            status: "queued",
            cancelRequested: false,
            requestJson: json(request),
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
    } catch (error) {
      const details = errorChain(error);
      if (details.includes("UNIQUE constraint failed") || details.includes("runs.run_id")) {
        throw new PersistenceError(
          "RUN_ALREADY_EXISTS",
          `Run ${request.batch.runId} already exists`,
        );
      }
      throw error;
    }
    return this.requireRun(request.batch.runId);
  }

  getRun(runId: RunId | string): DurableRun | undefined {
    const row = this.#db.select().from(runs).where(eq(runs.runId, runId)).get();
    return row ? runFromRow(row) : undefined;
  }

  requireRun(runId: RunId | string): DurableRun {
    const run = this.getRun(runId);
    if (!run) throw new PersistenceError("RUN_NOT_FOUND", `Run ${runId} was not found`);
    return run;
  }

  listRuns(options: { limit?: number; projectId?: string } = {}): DurableRun[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const query = this.#db.select().from(runs);
    const rows = options.projectId
      ? query
          .where(eq(runs.projectId, options.projectId))
          .orderBy(desc(runs.updatedAt))
          .limit(limit)
          .all()
      : query.orderBy(desc(runs.updatedAt)).limit(limit).all();
    return rows.map(runFromRow);
  }

  appendEvent(input: RunEvent): RunEvent {
    const event = RunEventSchema.parse(redactSecrets(input));
    this.#db.transaction((transaction) => {
      const duplicate = transaction
        .select({
          eventId: runEvents.eventId,
          runId: runEvents.runId,
          sequence: runEvents.sequence,
          payloadJson: runEvents.payloadJson,
        })
        .from(runEvents)
        .where(eq(runEvents.eventId, event.eventId))
        .get();
      if (duplicate) {
        if (
          duplicate.runId === event.runId &&
          duplicate.sequence === event.sequence &&
          duplicate.payloadJson === json(event.payload)
        ) {
          return;
        }
        throw new PersistenceError(
          "EVENT_ID_CONFLICT",
          `Event ${event.eventId} was already stored with different content`,
        );
      }
      const latest = transaction
        .select({ sequence: runEvents.sequence })
        .from(runEvents)
        .where(eq(runEvents.runId, event.runId))
        .orderBy(desc(runEvents.sequence))
        .limit(1)
        .get();
      const expected = (latest?.sequence ?? -1) + 1;
      if (event.sequence !== expected) {
        throw new PersistenceError(
          "EVENT_SEQUENCE_CONFLICT",
          `Expected event sequence ${expected} for ${event.runId}, received ${event.sequence}`,
        );
      }
      transaction
        .insert(runEvents)
        .values({
          eventId: event.eventId,
          runId: event.runId,
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          type: event.payload.type,
          jobId: eventJobId(event.payload),
          payloadJson: json(event.payload),
        })
        .run();
      this.#applyEvent(transaction, event);
    });
    return event;
  }

  appendSystemEvent(runId: RunId | string, payload: RunEventPayload): RunEvent {
    const latest = this.#db
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1)
      .get();
    const sequence = (latest?.sequence ?? -1) + 1;
    return this.appendEvent(
      RunEventSchema.parse({
        schemaVersion: 1,
        eventId: `${runId}:system:${sequence}`,
        runId,
        sequence,
        occurredAt: this.#clock().toISOString(),
        payload,
      }),
    );
  }

  listEvents(runId: RunId | string, afterSequence = -1): RunEvent[] {
    return this.#db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, afterSequence)))
      .orderBy(asc(runEvents.sequence))
      .all()
      .map((row) =>
        RunEventSchema.parse({
          schemaVersion: 1,
          eventId: row.eventId,
          runId: row.runId,
          sequence: row.sequence,
          occurredAt: row.occurredAt,
          payload: JSON.parse(row.payloadJson),
        }),
      );
  }

  requestCancellation(runId: RunId | string): { accepted: boolean; run: DurableRun } {
    const current = this.requireRun(runId);
    if (terminalStatuses.has(current.status)) return { accepted: false, run: current };
    const now = this.#clock().toISOString();
    this.#db
      .update(runs)
      .set({ cancelRequested: true, status: "cancelling", updatedAt: now })
      .where(eq(runs.runId, runId))
      .run();
    return { accepted: true, run: this.requireRun(runId) };
  }

  failRun(runId: RunId | string, code: string, message: string): DurableRun {
    const now = this.#clock().toISOString();
    this.#db
      .update(runs)
      .set({
        status: "failed",
        errorCode: code,
        errorMessage: redactText(message),
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(runs.runId, runId))
      .run();
    return this.requireRun(runId);
  }

  recordDeliveryResult(input: BatchDeliveryResult): DurableRun {
    const result = BatchDeliveryResultSchema.parse(redactSecrets(input));
    const request = BatchDeliveryRequestSchema.parse(this.requireRun(result.runId).request);
    const providers = new Map(
      request.batch.components.map((component) => [
        component.componentId,
        component.agent.provider,
      ]),
    );
    this.#db.transaction((transaction) => {
      transaction
        .update(runs)
        .set({
          status: result.status,
          resultJson: json(result),
          errorCode: result.code ?? null,
          errorMessage: result.message ?? null,
          completedAt: result.completedAt,
          updatedAt: result.completedAt,
        })
        .where(eq(runs.runId, result.runId))
        .run();
      for (const job of result.jobs) {
        const now = result.completedAt;
        transaction
          .insert(jobs)
          .values({
            jobId: job.jobId,
            runId: result.runId,
            componentId: job.componentId,
            status: job.status,
            errorCode: job.status === "failed" ? job.code : null,
            errorMessage: job.status === "failed" ? job.message : null,
            worktreeJson: job.worktree ? json(job.worktree) : null,
            sessionId: job.status === "passed" ? (job.sessionId ?? null) : null,
            createdAt: now,
            completedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: jobs.jobId,
            set: {
              status: job.status,
              errorCode: job.status === "failed" ? job.code : null,
              errorMessage: job.status === "failed" ? job.message : null,
              worktreeJson: job.worktree ? json(job.worktree) : null,
              sessionId: job.status === "passed" ? (job.sessionId ?? null) : null,
              completedAt: now,
              updatedAt: now,
            },
          })
          .run();
        if (job.worktree) {
          transaction
            .insert(worktrees)
            .values({
              jobId: job.jobId,
              runId: result.runId,
              branch: job.worktree.branch,
              checkoutDir: job.worktree.checkoutDir,
              workingDirectory: job.worktree.workingDirectory,
              baseCommit: job.worktree.baseCommit,
              createdAt: now,
            })
            .onConflictDoNothing()
            .run();
        }
        if (job.status === "passed" && job.sessionId) {
          transaction
            .insert(agentSessions)
            .values({
              sessionId: job.sessionId,
              runId: result.runId,
              jobId: job.jobId,
              provider: providers.get(job.componentId) ?? "unknown",
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: agentSessions.sessionId,
              set: { updatedAt: now },
            })
            .run();
        }
        for (const report of job.reports) this.#recordReport(transaction, job.jobId, report);
      }
      if (result.integration) {
        transaction
          .insert(integrationAttempts)
          .values({
            attemptId: `${result.runId}:integration:1`,
            runId: result.runId,
            status: result.integration.status,
            resultJson: json(result.integration),
            createdAt: result.completedAt,
          })
          .onConflictDoUpdate({
            target: integrationAttempts.attemptId,
            set: { status: result.integration.status, resultJson: json(result.integration) },
          })
          .run();
      }
    });
    return this.requireRun(result.runId);
  }

  recoverInterruptedRuns(reason = "Foundry restarted before the run completed"): DurableRun[] {
    const active = this.#db
      .select({ runId: runs.runId })
      .from(runs)
      .where(inArray(runs.status, ["queued", "running", "cancelling"]))
      .all();
    const recovered: DurableRun[] = [];
    for (const { runId } of active) {
      this.appendSystemEvent(runId, { type: "run.interrupted", reason });
      this.#db
        .update(workflowSteps)
        .set({ status: "interrupted", completedAt: this.#clock().toISOString() })
        .where(and(eq(workflowSteps.runId, runId), eq(workflowSteps.status, "running")))
        .run();
      recovered.push(this.requireRun(runId));
    }
    return recovered;
  }

  getSnapshot(runId: RunId | string): DurableRunSnapshot | undefined {
    const run = this.getRun(runId);
    if (!run) return undefined;
    const persistedJobs = this.#db
      .select()
      .from(jobs)
      .where(eq(jobs.runId, runId))
      .orderBy(asc(jobs.createdAt))
      .all()
      .map((row): DurableJob =>
        DurableJobSchema.parse({
          jobId: row.jobId,
          runId: row.runId,
          componentId: row.componentId,
          status: row.status,
          errorCode: row.errorCode ?? undefined,
          errorMessage: row.errorMessage ?? undefined,
          worktree: optionalJson(row.worktreeJson),
          sessionId: row.sessionId ?? undefined,
          createdAt: row.createdAt,
          startedAt: row.startedAt ?? undefined,
          completedAt: row.completedAt ?? undefined,
          updatedAt: row.updatedAt,
        }),
      );
    const steps = this.#db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.runId, runId))
      .orderBy(asc(workflowSteps.startedAt))
      .all()
      .map((row): WorkflowStep =>
        WorkflowStepSchema.parse({
          stepId: row.stepId,
          runId: row.runId,
          jobId: row.jobId ?? undefined,
          phase: row.phase,
          status: row.status,
          startedAt: row.startedAt,
          completedAt: row.completedAt ?? undefined,
        }),
      );
    const storedArtifacts = this.#db
      .select()
      .from(artifacts)
      .where(eq(artifacts.runId, runId))
      .orderBy(asc(artifacts.createdAt))
      .all()
      .filter(
        (row): row is typeof row & { kind: string; path: string; mediaType: string } =>
          row.kind !== null && row.path !== null && row.mediaType !== null,
      )
      .map((row): ArtifactRef =>
        ArtifactRefSchema.parse({
          artifactId: row.artifactId,
          kind: row.kind,
          path: row.path,
          mediaType: row.mediaType,
          createdAt: row.createdAt,
        }),
      );
    const reports = this.#db
      .select({ reportJson: verificationReports.reportJson })
      .from(verificationReports)
      .where(eq(verificationReports.runId, runId))
      .orderBy(asc(verificationReports.startedAt))
      .all()
      .map(({ reportJson }): VerificationReport =>
        VerificationReportSchema.parse(JSON.parse(reportJson)),
      );
    return DurableRunSnapshotSchema.parse({
      run,
      jobs: persistedJobs,
      steps,
      events: this.listEvents(runId),
      artifacts: storedArtifacts,
      verificationReports: reports,
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#sqlite.close();
  }

  #applyEvent(transaction: SqliteTransaction, event: RunEvent): void {
    const now = event.occurredAt;
    const payload = event.payload;
    switch (payload.type) {
      case "run.started":
        transaction
          .update(runs)
          .set({ status: "running", startedAt: now, updatedAt: now })
          .where(eq(runs.runId, event.runId))
          .run();
        break;
      case "run.interrupted":
        transaction
          .update(runs)
          .set({
            status: "interrupted",
            errorMessage: payload.reason,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(runs.runId, event.runId))
          .run();
        break;
      case "run.cancelled":
        transaction
          .update(runs)
          .set({
            status: "cancelled",
            errorMessage: payload.reason,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(runs.runId, event.runId))
          .run();
        break;
      case "run.completed":
        transaction
          .update(runs)
          .set({ status: payload.status, completedAt: now, updatedAt: now })
          .where(eq(runs.runId, event.runId))
          .run();
        break;
      case "job.queued":
      case "job.started": {
        const status = payload.type === "job.queued" ? "queued" : "running";
        transaction
          .insert(jobs)
          .values({
            jobId: payload.jobId,
            runId: event.runId,
            componentId: payload.componentId,
            status,
            createdAt: now,
            startedAt: payload.type === "job.started" ? now : null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: jobs.jobId,
            set: {
              status,
              startedAt: payload.type === "job.started" ? now : undefined,
              updatedAt: now,
            },
          })
          .run();
        break;
      }
      case "job.completed":
      case "job.cancelled":
      case "job.failed": {
        const status =
          payload.type === "job.completed"
            ? "completed"
            : payload.type === "job.cancelled"
              ? "cancelled"
              : "failed";
        transaction
          .update(jobs)
          .set({
            status,
            errorCode: payload.type === "job.failed" ? payload.code : null,
            errorMessage:
              payload.type === "job.failed"
                ? payload.message
                : payload.type === "job.cancelled"
                  ? payload.reason
                  : null,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(jobs.jobId, payload.jobId))
          .run();
        break;
      }
      case "phase.started":
        transaction
          .insert(workflowSteps)
          .values({
            stepId: `${payload.jobId ?? event.runId}:${payload.phase}`,
            runId: event.runId,
            jobId: payload.jobId ?? null,
            phase: payload.phase,
            status: "running",
            startedAt: now,
          })
          .onConflictDoUpdate({
            target: workflowSteps.stepId,
            set: { status: "running", startedAt: now, completedAt: null },
          })
          .run();
        break;
      case "phase.completed":
        transaction
          .update(workflowSteps)
          .set({ status: "completed", completedAt: now })
          .where(eq(workflowSteps.stepId, `${payload.jobId ?? event.runId}:${payload.phase}`))
          .run();
        break;
      case "artifact.created":
        transaction
          .insert(artifacts)
          .values({
            artifactId: payload.artifactId,
            runId: event.runId,
            jobId: payload.jobId ?? null,
            kind: payload.artifact?.kind ?? null,
            path: payload.artifact?.path ?? null,
            mediaType: payload.artifact?.mediaType ?? null,
            createdAt: payload.artifact?.createdAt ?? now,
          })
          .onConflictDoUpdate({
            target: artifacts.artifactId,
            set: {
              kind: payload.artifact?.kind,
              path: payload.artifact?.path,
              mediaType: payload.artifact?.mediaType,
              createdAt: payload.artifact?.createdAt,
            },
          })
          .run();
        break;
      case "agent.text":
      case "agent.tool.started":
      case "agent.tool.completed":
      case "verification.completed":
        break;
    }
  }

  #recordReport(transaction: SqliteTransaction, jobId: string, input: VerificationReport): void {
    const report = VerificationReportSchema.parse(input);
    transaction
      .insert(verificationReports)
      .values({
        reportId: `${report.runId}:${report.componentId}:${report.attempt}`,
        runId: report.runId,
        componentId: report.componentId,
        attempt: report.attempt,
        verdict: report.verdict,
        reportJson: json(report),
        startedAt: report.startedAt,
        completedAt: report.completedAt,
      })
      .onConflictDoUpdate({
        target: verificationReports.reportId,
        set: { verdict: report.verdict, reportJson: json(report), completedAt: report.completedAt },
      })
      .run();
    for (const artifact of report.gates.flatMap(({ artifacts: gateArtifacts }) => gateArtifacts)) {
      transaction
        .insert(artifacts)
        .values({
          artifactId: artifact.artifactId,
          runId: report.runId,
          jobId,
          kind: artifact.kind,
          path: artifact.path,
          mediaType: artifact.mediaType,
          createdAt: artifact.createdAt,
        })
        .onConflictDoUpdate({
          target: artifacts.artifactId,
          set: {
            kind: artifact.kind,
            path: artifact.path,
            mediaType: artifact.mediaType,
            createdAt: artifact.createdAt,
          },
        })
        .run();
    }
  }
}
