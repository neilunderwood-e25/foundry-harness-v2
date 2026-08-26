# Durable runs and live events

Milestone 6 adds a persistent control plane around the delivery pipeline. The existing synchronous
CLI and API remain available. A second API starts delivery in the background and returns immediately
with stable URLs for status and events.

## Storage

The standalone server stores state at `.foundry/state.sqlite` by default. Override it with:

```bash
FOUNDRY_DATABASE_PATH=/absolute/path/to/foundry.sqlite pnpm --filter @foundry/server start
```

The database uses WAL mode for file-backed databases, foreign keys, a busy timeout, and versioned
migrations. It contains:

- project profile and frozen foundation snapshots;
- run requests, final results, errors, and cancellation state;
- component jobs, worktrees, and agent session identifiers;
- workflow steps and append-only ordered events;
- artifact references and complete verification reports;
- integration attempts.

Credentials are not part of delivery requests and must remain in environment variables.

## Start and observe a delivery

Start the server, then submit a validated delivery document:

```bash
curl -X POST http://127.0.0.1:4600/api/runs/deliver/start \
  -H 'content-type: application/json' \
  --data-binary @examples/batch-delivery.json
```

The server returns HTTP `202` with `statusUrl` and `eventsUrl`.

Available endpoints:

```text
GET  /api/runs?limit=50&projectId=example-project
GET  /api/runs/:runId
GET  /api/runs/:runId/events?after=12
GET  /api/runs/:runId/events/stream
POST /api/runs/:runId/cancel
```

The snapshot endpoint includes jobs, workflow steps, events, artifacts, and verification reports.
The SSE endpoint emits the event sequence as its `id`, the payload type as its event name, and the
complete typed event as JSON data. Clients can reconnect with `Last-Event-ID` or `?after=`.

## Inspect local history from the CLI

```bash
node apps/cli/dist/index.js run list
node apps/cli/dist/index.js run show example-delivery-1
node apps/cli/dist/index.js run events example-delivery-1
```

Pass a database path as the final argument or set `FOUNDRY_DATABASE_PATH` when the database is not at
the default location.

## Recovery policy

At startup, Foundry changes any `queued`, `running`, or `cancelling` run to `interrupted`, appends a
`run.interrupted` event, and closes active workflow steps. Worktrees, session identifiers, logs, and
verification evidence remain available for inspection. Automatic agent-session resumption is
intentionally deferred until a provider-independent process ownership check exists.
