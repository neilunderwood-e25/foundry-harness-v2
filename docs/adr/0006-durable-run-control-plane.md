# ADR 0006 — SQLite-backed durable run control plane

## Status

Accepted.

## Decision

Foundry persists projects, run requests, jobs, worktrees, agent sessions, workflow steps, ordered
events, artifacts, verification reports, and integration attempts in a local SQLite database.
Drizzle is the typed persistence boundary and uses Node's bundled `node:sqlite` driver.

The durable run coordinator is an application service in the orchestrator package. It owns active
AbortControllers and subscribers, persists each event before broadcasting it, and records final
results. Fastify only exposes this service through HTTP and Server-Sent Events.

On process startup, queued, running, or cancelling records are marked `interrupted` and their active
steps are closed. Foundry preserves their evidence but does not silently resume an agent SDK session
whose process ownership cannot be proven.

## Consequences

- Run history and verification evidence survive server restarts.
- Event replay is ordered and rejects gaps or conflicting sequences.
- Cancellation is durable and propagates to active providers through `AbortSignal`.
- Live clients can reconnect with an event sequence and receive missed events before new ones.
- The coordinator remains the only application-level writer; HTTP handlers contain no workflow
  logic.
