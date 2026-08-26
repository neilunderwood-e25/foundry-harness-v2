import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  projectId: text("project_id").primaryKey(),
  rootDir: text("root_dir").notNull(),
  profileJson: text("profile_json").notNull(),
  foundationJson: text("foundation_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runs = sqliteTable(
  "runs",
  {
    runId: text("run_id").primaryKey(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    requestJson: text("request_json").notNull(),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("runs_updated_at_idx").on(table.updatedAt),
    index("runs_project_id_idx").on(table.projectId, table.updatedAt),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    jobId: text("job_id").primaryKey(),
    runId: text("run_id").notNull(),
    componentId: text("component_id").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    worktreeJson: text("worktree_json"),
    sessionId: text("session_id"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("jobs_run_id_idx").on(table.runId)],
);

export const workflowSteps = sqliteTable(
  "workflow_steps",
  {
    stepId: text("step_id").primaryKey(),
    runId: text("run_id").notNull(),
    jobId: text("job_id"),
    phase: text("phase").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("workflow_steps_run_id_idx").on(table.runId, table.startedAt)],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull(),
    runId: text("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    occurredAt: text("occurred_at").notNull(),
    type: text("type").notNull(),
    jobId: text("job_id"),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    uniqueIndex("run_events_event_id_idx").on(table.eventId),
    uniqueIndex("run_events_sequence_idx").on(table.runId, table.sequence),
    index("run_events_replay_idx").on(table.runId, table.sequence),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    artifactId: text("artifact_id").primaryKey(),
    runId: text("run_id").notNull(),
    jobId: text("job_id"),
    kind: text("kind"),
    path: text("path"),
    mediaType: text("media_type"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("artifacts_run_id_idx").on(table.runId)],
);

export const verificationReports = sqliteTable(
  "verification_reports",
  {
    reportId: text("report_id").primaryKey(),
    runId: text("run_id").notNull(),
    componentId: text("component_id").notNull(),
    attempt: integer("attempt").notNull(),
    verdict: text("verdict").notNull(),
    reportJson: text("report_json").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (table) => [
    uniqueIndex("verification_reports_attempt_idx").on(
      table.runId,
      table.componentId,
      table.attempt,
    ),
    index("verification_reports_run_id_idx").on(table.runId),
  ],
);

export const integrationAttempts = sqliteTable("integration_attempts", {
  attemptId: text("attempt_id").primaryKey(),
  runId: text("run_id").notNull(),
  status: text("status").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const worktrees = sqliteTable("worktrees", {
  jobId: text("job_id").primaryKey(),
  runId: text("run_id").notNull(),
  branch: text("branch").notNull(),
  checkoutDir: text("checkout_dir").notNull(),
  workingDirectory: text("working_directory").notNull(),
  baseCommit: text("base_commit").notNull(),
  createdAt: text("created_at").notNull(),
});

export const agentSessions = sqliteTable("agent_sessions", {
  sessionId: text("session_id").primaryKey(),
  runId: text("run_id").notNull(),
  jobId: text("job_id").notNull(),
  provider: text("provider").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
