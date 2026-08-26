# Verified delivery

Milestone 4 turns generated component worktrees into a verified integration branch without changing
the target project's active checkout.

## Workflow

`batch deliver` first delegates isolated component generation to the Milestone 3 executor. Completed
jobs then pass through these deterministic gates:

1. every changed file remains inside the component's section directory;
2. `section.manifest.json` parses and matches the component, CMS type, variant, owned files, and
   bindings;
3. every declared owned file exists and every changed file is declared;
4. the Style Guide and Container still match the frozen foundation fingerprint;
5. configured dependency installation, typecheck, lint, test, and production-build commands pass.
6. when enabled, desktop/mobile visual parity, intermediate-width reflow, and automated
   accessibility checks pass.

Tests are disabled by default because many application suites require external services. Build,
typecheck, lint, and dependency installation are enabled when configured. A delivery document can
override the policy:

```json
{
  "verification": {
    "installDependencies": true,
    "runBuild": true,
    "runTypecheck": true,
    "runLint": true,
    "runTests": false,
    "commandTimeoutMs": 300000
  }
}
```

The rest of the delivery document is identical to a batch execution document.

Visual and accessibility QA is configured separately under `quality`; see
[visual quality](visual-quality.md).

## Repair loop

When a gate fails, Foundry sends only the failed gate diagnostics back to the component's selected
provider. Codex resumes the original thread and Claude resumes the original session. The same
component ownership boundary remains in force. `agent.maxRepairTurns` limits additional turns; the
default is three.

Foundry re-runs the complete verification set after every repair. A component is committed only after
a passing report. Exhausted repairs leave the branch and worktree intact and exclude the component
from integration.

## Serial integration

Foundry creates `foundry/<run-id>/integration` from the exact batch base commit in an external
worktree. Verified component commits are cherry-picked in the original batch order. This avoids
merge races and never advances the target checkout or its current branch.

The integration worktree receives two deterministic generated files:

- `<sectionRoot>/foundry.registry.generated.ts` exposes registry-keyed lazy component and transform
  loaders.
- `<graphqlFragments-or-sectionRoot>/foundry.fragments.generated.ts` exposes the component fragment
  sources and their combined GraphQL document.

Manifests are sorted by registry key before those files are rendered, so repeated generation from the
same inputs produces stable output. Project commands run once more against the combined worktree.
The wiring commit is created only if that final verification passes.

## Interfaces

```bash
foundry batch deliver /absolute/path/to/delivery.json
```

The equivalent server endpoint is `POST /api/runs/deliver`. Both interfaces emit one ordered event
stream. The result includes every verification attempt, component commit, integration branch and
worktree, generated paths, final commit, and final integration report.
