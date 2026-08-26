# ADR 0005: Adapter-based visual quality gates

- Status: Accepted
- Date: 2026-08-26

## Decision

Visual QA runs as an optional deterministic verifier after code and runtime gates. Figma export,
preview lifecycle, browser inspection, image comparison, and artifact storage are explicit adapters.
The default implementation uses Figma image exports, a project dev command, Playwright Chromium,
pixelmatch, PNG artifacts, and axe analysis.

Projects provide a stable slug-addressable QA route and root selector. Artifacts live under the
external worktree root, never in the target repository. Repairable QA failures resume the component's
existing agent session with read access to the artifacts. Infrastructure failures stop without
spending repair turns.

## Consequences

The orchestrator consumes ordinary verification gates and does not depend on browser or image
details. Tests replace each adapter independently. Rendering remains reproducible only when the same
browser/runtime environment and a deterministic QA route are used, so quality enforcement is opt-in
until a project satisfies those prerequisites.
