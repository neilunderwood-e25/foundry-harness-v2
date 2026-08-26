# Execution infrastructure

Milestone 3 runs component agents concurrently without sharing a checkout. It deliberately stops
before verification, committing, or integration.

## Provider boundary

`@foundry/agent-runtime` owns the provider contract, normalized text/tool events, provider registry,
and the component implementation prompt. Codex and Claude SDK details stay in their dedicated
adapter packages. Both adapters use non-interactive edit modes, stream progress, retain session IDs,
and support cancellation.

## Worktree isolation

Each component job receives a new branch and Git worktree created from the batch's exact base
commit. The worktree storage root must be outside the target repository. This avoids polluting the
target checkout and allows multiple agents to edit concurrently.

Worktrees are retained whether a job succeeds or fails. Milestone 3 never commits, removes, merges,
or rebases them. A later verification and integration milestone owns those actions.

## Concurrency and ownership

The batch executor uses `maxParallel` as a hard concurrency limit. It emits one ordered run event
stream even though jobs execute concurrently. Once an agent finishes, the executor reads Git status
and rejects changes outside that component's section directory.

## Running a batch

The execution document combines the frozen project profile, ready foundation, batch specification,
and an external worktree storage directory.

```bash
pnpm build
node apps/cli/dist/index.js batch execute /absolute/path/to/execution.json
```

Events are written as JSON Lines to stderr and the final batch result is written to stdout. The same
operation is available as `POST /api/runs/execute`.

The selected SDK must already be authenticated in the local environment. Provider errors are
normalized, and a provider that is not configured fails only its assigned job.
