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
