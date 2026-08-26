# ADR 0001: Local TypeScript modular monolith

- Status: Accepted
- Date: 2026-08-26

## Decision

Foundry will begin as a local TypeScript modular monolith on Node.js. The server, CLI, and web UI
call the same application services. Domain packages cannot import infrastructure or presentation
packages.

## Consequences

We get one deployment unit and one source of truth without collapsing boundaries into large engine
files. Processes may be introduced for agent-worker isolation, but they remain coordinated by the
local application rather than becoming independently deployed services.
