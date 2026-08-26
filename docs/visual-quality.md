# Visual quality

Milestone 5 adds artifact-producing visual and accessibility gates to `batch deliver`. It is opt-in
so existing projects can establish a deterministic QA route before enforcing visual parity.

## Prerequisites

The target project must expose a component QA route. By default Foundry navigates to `/qa/{slug}`
and locates `[data-foundry="{slug}"]`. Component prompts require the marker on each generated
section's root element. A project-specific route or selector can be supplied in the delivery policy,
but both templates must contain `{slug}`.

Set a Figma personal access token in `FIGMA_ACCESS_TOKEN`, or change `figmaTokenEnv` to the name of
the environment variable managed by the operator. Foundry reads the value only when making Figma
image-export requests and never writes it to an artifact or target worktree.

Install the pinned Playwright Chromium runtime once on the execution host:

```bash
pnpm quality:install-browser
```

## Delivery policy

```json
{
  "quality": {
    "enabled": true,
    "routeTemplate": "/qa/{slug}",
    "selectorTemplate": "[data-foundry=\"{slug}\"]",
    "maxDiffRatio": 0.03,
    "pixelThreshold": 0.1,
    "runAccessibility": true,
    "minimumAccessibilityImpact": "serious",
    "startupTimeoutMs": 90000,
    "navigationTimeoutMs": 60000,
    "figmaTokenEnv": "FIGMA_ACCESS_TOKEN"
  }
}
```

`maxDiffRatio` is the maximum share of compared pixels that may differ at either breakpoint.
`pixelThreshold` controls the perceptual sensitivity of each individual pixel comparison. Foundry
uses the exported Figma frame width as the browser viewport, disables motion, captures only the
marked section, and normalizes transparent reference pixels before comparison.

## Gates

Each attempt adds these gates after code and runtime verification:

- desktop visual parity;
- mobile visual parity;
- horizontal reflow at the midpoint between the two design widths;
- axe violations at or above `minimumAccessibilityImpact`.

Visual, reflow, and accessibility failures are repairable. Their artifact directories are added as
read-only context when Codex or Claude resumes the implementation session. Infrastructure failures
such as missing Figma credentials or an unavailable browser are non-repairable and stop the repair
loop immediately.

## Artifacts

Artifacts are stored under the external worktree root:

```text
<worktreeRoot>/<run>/artifacts/<component>/
├── references/
│   ├── desktop-reference.png
│   └── mobile-reference.png
└── attempt-<n>/
    ├── desktop-actual.png
    ├── desktop-diff.png
    ├── mobile-actual.png
    ├── mobile-diff.png
    ├── accessibility.json
    └── quality-error.log
```

References are cached across repair attempts. Attempt outputs are immutable evidence attached to the
corresponding verification report and surfaced through `artifact.created` run events. No QA artifact
is committed to the target repository.
