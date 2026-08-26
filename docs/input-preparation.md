# Structured input preparation

Milestone 7 adds a deterministic preflight between the frozen project foundation and parallel agent
generation. Enable it in a delivery request:

```json
{
  "inputPreparation": {
    "enabled": true,
    "outputRoot": "/absolute/path/to/foundry-inputs",
    "fetchSampleEntry": true,
    "failOnReview": true,
    "requestTimeoutMs": 60000,
    "figmaTokenEnv": "FIGMA_ACCESS_TOKEN"
  }
}
```

If `outputRoot` is omitted, artifacts are written under
`<worktreeRoot>/<runId>/inputs`. They are outside the target Next.js checkout and are provided to
agents as read-only evidence.

## Credentials

Figma:

```bash
FIGMA_ACCESS_TOKEN=...
```

Contentful:

```bash
CONTENTFUL_SPACE_ID=...
CONTENTFUL_DELIVERY_TOKEN=...
CONTENTFUL_ENVIRONMENT_ID=master       # optional
CONTENTFUL_CDA_HOST=cdn.contentful.com # optional
```

Contentstack:

```bash
CONTENTSTACK_API_KEY=...
CONTENTSTACK_DELIVERY_TOKEN=...
CONTENTSTACK_ENVIRONMENT=production
CONTENTSTACK_CDA_HOST=cdn.contentstack.io # optional; use the regional CDA host when needed
```

Tokens are request headers inside the adapters. They are never serialized into delivery requests,
artifacts, events, plans, or agent prompts.

## Outputs

Each component gets:

- desktop and mobile Figma node snapshots, PNG references, and referenced image-fill artifacts;
- observed frame dimensions, layout modes, colors, typography, spacing, component instances, and
  node-type counts;
- a normalized CMS schema and optional sample-response artifact;
- a deterministic field-binding plan with cardinality, requiredness, transform, and render hints;
- an exact component plan covering owned files, fragment name, registry key, reusable project
  primitives, style-guide matches, responsive strategy, and review issues.

Artifact names include a SHA-256 content digest. Repeating preparation with unchanged upstream
content reuses the same paths.

## Review gates

The planner marks a component `review-required` when:

- the desktop frame is not wider than the mobile frame; or
- the mapped CMS `variantField` does not exist in the inspected content type.

With `failOnReview: true`, the phase fails before `BatchExecutor` can create a worktree. Missing
exact color or typography token matches are warnings: the agent must stay within the frozen project
foundation rather than invent shared tokens.

## Run preparation without agents

Build once, then run either interface:

```bash
node apps/cli/dist/index.js batch prepare /absolute/path/to/delivery.json

curl -X POST http://127.0.0.1:4600/api/inputs/prepare \
  -H 'content-type: application/json' \
  --data-binary @examples/batch-delivery.json
```

Both preflight interfaces force preparation on for that invocation. Normal delivery uses the
request's `inputPreparation.enabled` value.
