# ADR 0002: Provider-neutral agent runtime

- Status: Accepted
- Date: 2026-08-26

## Decision

Claude and Codex integrations implement a Foundry-owned `AgentProvider` contract. Native SDK types,
events, and error shapes stay inside their provider package. The shared contract exposes explicit
capabilities instead of assuming both providers behave identically.

## Consequences

The orchestrator can select a provider per job and test workflows with a fake provider. Provider-
specific features remain possible through declared capabilities without leaking SDK concerns into
the build workflow.
