# Project readiness

Component builds are blocked until a target repository has a supported `ProjectProfile` and a
ready `ProjectFoundation`.

## Project inspection

Inspection is read-only. It detects the Next.js router and app directory, package manager and
commands, section conventions, GraphQL paths, CMS dependencies, and the exact Git commit that later
worktrees must use. Errors make the project unsupported; warnings require attention but do not hide
the discovered profile.

```bash
foundry project inspect /absolute/path/to/project
```

## Foundation inspection

The foundation detector extracts named color and spacing tokens, complete typography utilities,
pixel breakpoints, reusable UI primitives, and Container geometry. A ready foundation is hashed
from the exact Style Guide and Container files.

```bash
foundry foundation inspect /absolute/path/to/project
```

Passing a previously frozen foundation to the API marks it stale when those files change. Accepting
the change is an explicit action; component agents cannot update foundation files.

## Foundation setup

When a project has no usable foundation, setup requires a validated specification containing every
token, breakpoint, maximum width, and per-side padding value. It creates a token stylesheet, wires
that stylesheet into the project's global CSS, creates a Container with machine-readable metadata,
and immediately re-inspects the result.

```bash
foundry foundation setup /absolute/path/to/project foundation-setup.json
```

Setup refuses to overwrite existing foundation files unless an API caller explicitly enables the
overwrite option.
