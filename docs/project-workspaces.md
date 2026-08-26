# Project workspaces

Milestone 9 completes the project-facing side of the product interface. A workspace is the durable
record Foundry uses to decide whether a Next.js repository is ready for component generation.

## Console workflow

Open `/console/` and select **Projects**.

1. Register an absolute Next.js repository path and an optional project ID.
2. Foundry performs read-only project inspection.
3. It detects and fingerprints the Style Guide and Container.
4. The workspace is stored with a `ready`, `missing`, or `stale` foundation status.
5. Use **Refresh readiness** after the target repository changes.
6. If protected foundation files changed intentionally, review the new project state and use
   **Accept foundation changes** to freeze the new fingerprint.

The detail view shows framework conventions, package manager, section and GraphQL paths, protected
foundation files, token coverage, Container geometry, the inspected commit, and the frozen
fingerprint.

## CLI

```bash
pnpm build
node apps/cli/dist/index.js project add /absolute/path/to/project my-project
node apps/cli/dist/index.js project list
node apps/cli/dist/index.js project show my-project
node apps/cli/dist/index.js project refresh my-project
node apps/cli/dist/index.js project refresh my-project .foundry/state.sqlite --accept-changes
```

The optional final positional argument selects a database path. Otherwise the CLI uses
`FOUNDRY_DATABASE_PATH` or `.foundry/state.sqlite`.

## API

```text
GET  /api/projects
GET  /api/projects/:projectId
POST /api/projects/register
POST /api/projects/:projectId/refresh
```

Registration accepts `rootDir`, optional `projectId`, and optional `acceptFoundationChanges`.
Refresh accepts optional `acceptFoundationChanges`.

Project registration and refresh do not generate or overwrite Style Guide or Container files.
Use the existing foundation setup command or API with a complete setup specification for that
explicit write operation.
