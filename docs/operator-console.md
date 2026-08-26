# Operator console

Milestone 8 turns the durable run API into an operational workspace. The console is intentionally
local-first and has no direct database or agent SDK access.

The interface uses shadcn/ui preset `b5JPPcgmu` (`base-vega`, Mist tokens, Base UI primitives,
Inter Variable, and Lucide icons). Shared primitives live in `apps/console/src/components/ui`.

## Production-style local run

```bash
pnpm build
FOUNDRY_DATABASE_PATH=.foundry/state.sqlite node apps/server/dist/index.js
```

Open `http://127.0.0.1:4600/console/`. The server redirects `/` there and serves the compiled Vite
assets. API, SSE, and artifact traffic remain on the same origin.

## Development

Run these in separate terminals:

```bash
pnpm dev:server
pnpm dev:console
```

Open `http://127.0.0.1:4601/console/`. Vite proxies `/health` and `/api` to the harness at port 4600.

## Capabilities

- Register Next.js projects before their first run.
- Review ready, missing, and stale Style Guide/Container foundations.
- Refresh project readiness and explicitly accept reviewed foundation changes.
- Review release thresholds and Claude/Codex results in the Insights workspace.
- Search recent runs and filter them by project.
- See harness availability and active/passed run totals.
- Launch a schema-version-1 delivery document without placing credentials in the JSON.
- Duplicate a previous request into the launch editor.
- Monitor multiple component agents, their providers, status, and elapsed time.
- Follow preparation, worktree, agent, verification, repair, commit, and integration stages.
- Receive live updates over the existing resumable SSE stream with polling fallback.
- Cancel queued or active runs explicitly.
- Inspect append-only events, failed verification gates, screenshots, diffs, reports, logs, and
  prepared-input artifacts.
- Download a sanitized diagnostics bundle for any run.

## Artifact safety

The route `GET /api/runs/:runId/artifacts/:artifactId` does not accept a path. It resolves the
artifact identifier from that run's durable snapshot before reading the file. Missing run records,
artifact records, and files return distinct `404` errors.

The console displays sample-response artifacts only when input preparation retained them. CMS and
Figma credentials are never part of console payloads.
