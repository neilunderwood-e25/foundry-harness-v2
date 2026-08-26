import type { DatabaseSync } from "node:sqlite";

interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

const migrations: readonly Migration[] = [
  {
    id: 1,
    name: "initial_control_plane",
    sql: `
      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY NOT NULL,
        root_dir TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        foundation_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(project_id),
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        request_json TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX runs_updated_at_idx ON runs(updated_at DESC);
      CREATE INDEX runs_project_id_idx ON runs(project_id, updated_at DESC);

      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        component_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        worktree_json TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX jobs_run_id_idx ON jobs(run_id);

      CREATE TABLE workflow_steps (
        step_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        job_id TEXT,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX workflow_steps_run_id_idx ON workflow_steps(run_id, started_at);

      CREATE TABLE run_events (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        type TEXT NOT NULL,
        job_id TEXT,
        payload_json TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );
      CREATE INDEX run_events_replay_idx ON run_events(run_id, sequence);

      CREATE TABLE artifacts (
        artifact_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        job_id TEXT,
        kind TEXT,
        path TEXT,
        media_type TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX artifacts_run_id_idx ON artifacts(run_id);

      CREATE TABLE verification_reports (
        report_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        component_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        report_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        UNIQUE(run_id, component_id, attempt)
      );
      CREATE INDEX verification_reports_run_id_idx ON verification_reports(run_id);

      CREATE TABLE integration_attempts (
        attempt_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE worktrees (
        job_id TEXT PRIMARY KEY NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        branch TEXT NOT NULL,
        checkout_dir TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE agent_sessions (
        session_id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function migrate(database: DatabaseSync, clock: () => Date = () => new Date()): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = database.prepare("SELECT id FROM schema_migrations").all() as Array<{
    id: number;
  }>;
  const appliedIds = new Set(applied.map(({ id }) => id));
  const insert = database.prepare(
    "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
  );
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      insert.run(migration.id, migration.name, clock().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
