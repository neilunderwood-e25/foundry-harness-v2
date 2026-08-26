# ADR 0003: Frozen project foundation

- Status: Accepted
- Date: 2026-08-26

## Decision

A style guide and Container form a versioned `ProjectFoundation`. Component builds require a ready
foundation whose fingerprint matches the build specification. Existing valid foundations are
read-only; missing foundations are configured in dedicated serial workflows.

## Consequences

Every parallel agent receives the same design-token and layout contract. Component jobs cannot edit
foundation files. A foundation change marks pending specifications stale and requires re-inspection.
