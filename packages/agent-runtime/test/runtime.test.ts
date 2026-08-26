import {
  ComponentBuildSpecSchema,
  ProjectProfileSchema,
  ReadyProjectFoundationSchema,
} from "@foundry/contracts";
import { describe, expect, it } from "vitest";
import {
  AgentProviderError,
  AgentProviderRegistry,
  buildComponentPrompt,
  buildRepairPrompt,
  type AgentProvider,
} from "../src/index.js";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

const specification = ComponentBuildSpecSchema.parse({
  schemaVersion: 1,
  runId: "run-1",
  componentId: "hero",
  projectId: "project-1",
  baseCommit: sha,
  foundationFingerprint: fingerprint,
  name: "Hero",
  slug: "hero",
  design: {
    desktopFrameUrl: "https://figma.com/design/file/Foundry?node-id=1-2",
    mobileFrameUrl: "https://figma.com/design/file/Foundry?node-id=3-4",
  },
  cms: {
    provider: "contentful",
    contentType: "HeroSection",
    variantField: "frontendComponent",
    variantValue: "Hero",
  },
  agent: { provider: "codex" },
});

const project = ProjectProfileSchema.parse({
  schemaVersion: 1,
  projectId: "project-1",
  rootDir: "/tmp/project",
  inspectedCommit: sha,
  framework: { kind: "nextjs", router: "app", appDir: "src/app" },
  packageManager: "pnpm",
  commands: {
    install: { executable: "pnpm", args: ["install"] },
    build: { executable: "pnpm", args: ["build"] },
    dev: { executable: "pnpm", args: ["dev"] },
  },
  paths: { sectionRoot: "src/components/sections" },
});

const foundation = ReadyProjectFoundationSchema.parse({
  schemaVersion: 1,
  projectId: "project-1",
  status: "ready",
  sourceCommit: sha,
  fingerprint,
  reasons: [],
  styleGuide: {
    source: "existing",
    files: ["src/styles/tokens.css"],
    colors: [],
    spacing: [],
    typography: [],
    breakpoints: { md: 768 },
    primitives: [],
  },
  container: {
    source: "existing",
    componentPath: "src/components/ui/Container.tsx",
    importPath: "@/components/ui/Container",
    desktopMaxWidth: 1440,
    mobileMaxWidth: "fluid",
    paddingByBreakpoint: { base: { top: 0, right: 16, bottom: 0, left: 16 } },
    supportsFullBleed: true,
    supportedProps: ["children"],
  },
});

function fakeProvider(name: "codex" | "claude"): AgentProvider {
  return {
    name,
    capabilities: { streaming: true, sessions: true, toolEvents: true, cancellation: true },
    async execute() {
      return { status: "completed" };
    },
  };
}

describe("agent runtime", () => {
  it("resolves registered providers and rejects duplicate registration", () => {
    const registry = new AgentProviderRegistry([fakeProvider("codex")]);
    expect(registry.resolve("codex").name).toBe("codex");
    expect(() => registry.resolve("claude")).toThrowError(AgentProviderError);
    expect(() => registry.register(fakeProvider("codex"))).toThrow(/already registered/i);
  });

  it("builds a component-scoped prompt from frozen project inputs", () => {
    const prompt = buildComponentPrompt({ specification, project, foundation });
    expect(prompt).toContain("src/components/sections/hero");
    expect(prompt).toContain(fingerprint);
    expect(prompt).toContain(specification.design.desktopFrameUrl);
    expect(prompt).toContain("Do not commit");
  });

  it("turns failed verification gates into a component-scoped repair prompt", () => {
    const prompt = buildRepairPrompt(
      {
        schemaVersion: 1,
        runId: specification.runId,
        componentId: specification.componentId,
        verdict: "failed",
        attempt: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: [
          {
            id: "manifest",
            label: "Section manifest",
            category: "data",
            status: "failed",
            detail: "ownedFiles is incomplete",
            artifacts: [],
          },
        ],
      },
      "src/components/sections/hero",
    );
    expect(prompt).toContain("ownedFiles is incomplete");
    expect(prompt).toContain("src/components/sections/hero");
    expect(prompt).toContain("Do not commit");
  });
});
