# 0008 — Read-only-by-default local operator console

Status: accepted

## Context

Milestone 6 made runs durable and observable through JSON and SSE APIs, but operators still needed
curl commands or direct database inspection to understand parallel work. Starting a run, following
worktrees, finding failed gates, and locating retained screenshots were spread across different API
responses.

## Decision

Foundry includes a separate React and Vite single-page console backed only by the public server API.
The server hosts its production build under `/console/`; the Vite development server proxies the
same API paths.

The console is read-only by default. Its only state-changing actions are explicit delivery launch
and active-run cancellation. It uses TanStack Query for server-state caching and invalidation, and
SSE as a freshness signal. SQLite remains behind the server boundary.

Artifact files are delivered by a run-scoped lookup route: the server first resolves the artifact
from the run snapshot and only then reads the stored path. The console cannot request an arbitrary
filesystem path.

## Consequences

Operators get one view of batch progress, component workers, stages, events, verification reports,
and evidence. Console failure cannot affect the harness or its active agents. The compiled server
expects `apps/console/dist` to exist when serving the UI, so production startup follows the root
`pnpm build` command.
