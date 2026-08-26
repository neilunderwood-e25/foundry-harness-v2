# ADR 0004: Worktree isolation and serial integration

- Status: Accepted
- Date: 2026-08-26

## Decision

Every component job runs in its own Git worktree created from the batch's exact base commit. Agents
write component-scoped files and a `SectionManifest`. Passed component commits integrate serially;
the harness generates shared GraphQL and registry wiring from manifests.

## Consequences

Parallel agents do not compete over shared files. Failed worktrees remain inspectable. Integration
is deterministic, idempotent, and independently verified before it reaches the target branch.
