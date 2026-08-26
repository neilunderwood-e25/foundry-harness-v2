# Foundry Harness v2

Foundry is a local-first agent harness for generating production-ready, CMS-connected Next.js
section components from paired desktop/mobile Figma frames and a mapped CMS content type.

The harness owns preparation, isolation, verification, repair, and integration. Claude or Codex
agents make implementation decisions inside component-scoped Git worktrees.

## Principles

- The harness, not the agent, decides whether a build passes.
- A project's style guide and Container are frozen before parallel component generation.
- Each component agent works in an isolated worktree from the same base commit.
- Agents create component-scoped files; shared GraphQL and registry wiring is deterministic.
- SDK, CMS, Figma, Git, and framework integrations sit behind explicit adapters.

## Development

Requirements: Node.js 24 and pnpm 11.

```bash
pnpm install
pnpm check
```

See [the architecture decisions](docs/adr/README.md) for the system boundaries.

## Project readiness

Foundry can inspect a target repository and freeze its Style Guide and Container before any
component workers are allowed to run:

```bash
pnpm build
node apps/cli/dist/index.js project inspect /absolute/path/to/project
node apps/cli/dist/index.js foundation inspect /absolute/path/to/project
```

Projects without a valid foundation can be configured from an explicit setup document; see
[project readiness](docs/project-readiness.md) and the
[example foundation specification](examples/foundation-setup.json).

## Parallel execution

Milestone 3 adds provider-neutral Codex and Claude SDK adapters, exact-commit Git worktrees, bounded
parallel component jobs, ordered execution events, cancellation, and component ownership checks.
See [execution infrastructure](docs/execution-infrastructure.md).

## Verified delivery

Milestone 4 composes parallel generation with deterministic verification, bounded same-session
repairs, component commits, and serial integration. Passed commits are cherry-picked in batch order
into a dedicated integration worktree. Foundry generates registry loaders and a combined GraphQL
fragment document there, verifies the integrated project, and leaves the target checkout untouched.

```bash
pnpm build
node apps/cli/dist/index.js batch deliver /absolute/path/to/delivery.json
```

See [verified delivery](docs/verified-delivery.md) for the gates, repair policy, generated files, and
integration guarantees.

## Visual quality

Milestone 5 adds opt-in desktop/mobile pixel comparison against the exact Figma frames,
intermediate-width reflow checks, and axe accessibility analysis. Screenshots, diffs, references,
logs, and accessibility reports are retained outside the target repository and attached to the
verification gates that drive agent repairs.

See [visual quality](docs/visual-quality.md) for preview-route requirements, Figma authentication,
Chromium setup, thresholds, and artifacts.

## Durable runs

Milestone 6 adds a SQLite-backed run control plane with migrations, append-only event replay,
background delivery, durable cancellation, restart recovery, artifact/report history, and live
Server-Sent Events. The existing synchronous delivery interfaces remain available.

```bash
pnpm build
node apps/server/dist/index.js
curl -X POST http://127.0.0.1:4600/api/runs/deliver/start \
  -H 'content-type: application/json' \
  --data-binary @examples/batch-delivery.json
```

See [durable runs and live events](docs/durable-runs.md) for the database, API, SSE reconnection,
cancellation, recovery, and CLI history commands.

## Structured input preparation

Milestone 7 resolves each Figma frame and CMS type before any agent worktree is created. It stores
immutable screenshots, image assets, raw CMS schemas, optional sample responses, normalized design
and CMS snapshots, a field-binding plan, and a component file plan. Agents receive those plans and
artifact paths instead of credentials or loosely interpreted URLs.

```bash
export FIGMA_ACCESS_TOKEN=...
export CONTENTFUL_SPACE_ID=...
export CONTENTFUL_DELIVERY_TOKEN=...
node apps/cli/dist/index.js batch prepare /absolute/path/to/delivery.json
```

See [structured input preparation](docs/input-preparation.md) for Contentful and Contentstack
configuration, review gates, artifacts, and the preflight API.

## Operator console

Milestone 8 adds a responsive web console over the durable run control plane. Operators can launch
delivery documents, filter and inspect run history, watch parallel component jobs and harness stages
over SSE, cancel active runs, review failed verification gates, and open retained evidence without
using SQLite or raw API calls.

```bash
pnpm build
node apps/server/dist/index.js
open http://127.0.0.1:4600/console/
```

For live console development, run `pnpm dev:server` and `pnpm dev:console` in separate terminals,
then open `http://127.0.0.1:4601/console/`. See [operator console](docs/operator-console.md).

## Project workspaces

Milestone 9 makes inspected projects durable before their first delivery. The console **Projects**
workspace registers Next.js repositories, shows their detected conventions, Style Guide and
Container profiles, and refreshes readiness without silently accepting changed foundation files.
The same operations are available through the API and `foundry project add|list|show|refresh`.

See [project workspaces](docs/project-workspaces.md) for the workflow and commands.

## Production hardening

Milestone 10 adds release evaluation reports, provider comparisons, secret redaction before durable
storage, sanitized diagnostics bundles, and a headless CI verdict. The console **Insights** workspace
shows quality thresholds across run success, first-turn generation, repairs, visual parity,
accessibility, runtime, and integration conflicts.

```bash
pnpm build
node apps/cli/dist/index.js evaluate .foundry/state.sqlite examples/evaluation-policy.json
node apps/cli/dist/index.js run diagnostics <run-id>
```

See [production hardening](docs/production-hardening.md) for the security boundary, evaluation
metrics, CI behavior, and diagnostics policy.
