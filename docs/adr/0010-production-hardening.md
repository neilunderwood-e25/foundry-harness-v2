# 0010 — Evaluation-gated production hardening

Status: accepted

## Context

Foundry could retain and inspect individual runs, but it did not convert run history into a release
signal. Provider output and infrastructure failures also crossed persistence and artifact boundaries
without one mandatory redaction layer, and support diagnostics required sharing raw database state.

## Decision

Foundry evaluates durable run snapshots through a provider-neutral metrics package. A versioned
policy defines minimum sample size and thresholds for run/component success, first-turn success,
visual and accessibility gates, and merge conflicts. The same report powers the local Insights UI,
HTTP API, and headless CLI exit code.

Secret redaction is a shared infrastructure boundary. Agent events are redacted before publication
or persistence, terminal failures and delivery results are redacted before storage, and quality logs
are redacted before writing. Diagnostics contain a redacted snapshot and artifact metadata, never
artifact contents or environment values.

## Consequences

Prompt and workflow changes can be checked against stable release thresholds, and Claude/Codex
results are comparable without provider SDK types entering evaluation code. Support bundles are
safe by default. Pattern-based redaction is defense in depth rather than permission to place
credentials in delivery documents; credentials must still enter only through environment adapters.
