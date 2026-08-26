# Production hardening

Milestone 10 turns durable run history into a release gate and adds mandatory sanitation at the
persistence and diagnostics boundaries.

## Evaluation

The evaluator reads up to 200 durable snapshots and reports:

- run and component pass rates;
- first-turn success and repair success;
- final visual and accessibility gate pass rates;
- average component runtime;
- integration merge-conflict rate;
- per-provider pass rate and runtime.

The console **Insights** workspace uses `GET /api/evaluations/summary`. For headless use, build the
CLI and provide the database, optional policy, and optional report output path:

```bash
pnpm build
node apps/cli/dist/index.js evaluate \
  .foundry/state.sqlite \
  examples/evaluation-policy.json \
  .foundry/evaluation-report.json
```

The process exits non-zero when any threshold fails, making it suitable for CI. An empty sample
fails the default minimum-runs threshold instead of reporting a misleading green baseline.

## Secret handling

Provider and CMS credentials remain environment-only. Foundry additionally redacts:

- configured secret environment values;
- sensitive object fields such as `token`, `password`, `authorization`, and `privateKey`;
- bearer credentials and common API-token shapes in free text.

Redaction runs before agent events, terminal failures, and delivery results are persisted. Quality
infrastructure logs are sanitized before they are written. This is defense in depth; delivery JSON
must never contain credentials.

## Diagnostics

Download a run bundle from the console or use:

```bash
node apps/cli/dist/index.js run diagnostics <run-id>
```

The JSON bundle contains system versions, the redacted durable snapshot, event history, verification
reports, and artifact metadata. Artifact contents and environment values are deliberately excluded.

API routes:

```text
GET /api/evaluations/summary?limit=100
GET /api/runs/:runId/diagnostics
```
