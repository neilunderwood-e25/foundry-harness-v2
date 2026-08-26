# 0007 — Provider-neutral structured input preparation

Status: accepted

## Context

Giving a coding agent two Figma URLs and a CMS type name leaves too much discovery and
interpretation inside an isolated worktree. That duplicates network work across repair turns,
allows credentials to leak into prompts, makes results sensitive to provider behavior, and gives
the harness no deterministic place to reject ambiguous mappings before generation starts.

## Decision

Foundry performs a dedicated input-preparation phase before it creates component worktrees.

- A shared Figma REST adapter resolves both frame nodes, exports reference screenshots, downloads
  referenced image fills, and normalizes layout, color, typography, spacing, instance, and asset
  observations.
- Contentful and Contentstack adapters inspect their delivery schemas and optionally fetch one
  sample response. Both produce the same normalized CMS field contract.
- A deterministic planner derives GraphQL-to-prop bindings, owned component paths, fragment and
  manifest names, reusable project primitives, foundation-token matches, and responsive guidance.
- Every external response and derived plan is stored outside the target repository as an immutable,
  content-addressed artifact.
- Credentials are read only from environment variables inside adapters. Prompts contain normalized
  contracts and artifact paths, never access tokens.
- Ambiguous breakpoint ordering or a missing mapped variant field produces `review-required`.
  Delivery stops before worktree creation when `failOnReview` is enabled.

The preparation packages depend on contracts and small adapter interfaces. Agent providers and CMS
SDK-specific behavior remain outside the planner.

## Consequences

Agent runs become reproducible from retained evidence and receive less provider-specific context.
Parallel jobs share one bounded preparation phase, while each component still owns an independent
snapshot and plan. A run now requires valid Figma and CMS credentials when preparation is enabled,
and external API changes are isolated to their adapters.
