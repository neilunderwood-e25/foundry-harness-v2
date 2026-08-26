# 0009 — Persist inspected project workspaces

Status: accepted

## Context

Foundry could inspect a Next.js repository and freeze its Style Guide and Container, but those
results were request-scoped. Runs incidentally stored project JSON, while the operator console
derived its project filter from run history. A project therefore could not be prepared, reviewed,
or refreshed before its first delivery.

## Decision

Foundry treats a registered project as a durable workspace containing a versioned
`ProjectProfile` and `ProjectFoundation`. Registration performs read-only Next.js inspection,
inspects the foundation, and stores both snapshots together. Refresh repeats the inspection using
the previous foundation so changed protected files become `stale` until an operator explicitly
accepts the new fingerprint.

The server exposes project registration, listing, detail, and refresh through the same application
boundary used by the CLI and React console. The frontend never reads repositories or SQLite
directly. Foundation generation remains a separate explicit setup operation because it writes to
the target repository and requires a complete validated setup specification.

## Consequences

Operators can establish project readiness before starting an agent, see missing or stale
foundations, and inspect the exact protected Style Guide and Container context. Run history and
project readiness no longer depend on one another. Reinspection is safe by default: a changed
foundation is reported rather than silently trusted.
