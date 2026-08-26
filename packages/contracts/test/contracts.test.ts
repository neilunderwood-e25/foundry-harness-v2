import { describe, expect, it } from "vitest";
import {
  BatchBuildSpecSchema,
  ComponentBuildSpecSchema,
  ProjectFoundationSchema,
  RelativeProjectPathSchema,
} from "../src/index.js";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

const component = {
  schemaVersion: 1,
  runId: "run-1",
  componentId: "hero",
  projectId: "project-1",
  baseCommit: sha,
  foundationFingerprint: fingerprint,
  name: "Hero",
  slug: "hero",
  design: {
    desktopFrameUrl: "https://www.figma.com/design/file/Foundry?node-id=1-2",
    mobileFrameUrl: "https://www.figma.com/design/file/Foundry?node-id=3-4",
  },
  cms: {
    provider: "contentful",
    contentType: "HeroSection",
    variantField: "frontendComponent",
    variantValue: "Hero",
  },
  agent: { provider: "codex" },
} as const;

describe("component build contracts", () => {
  it("accepts strict Figma, CMS and foundation inputs", () => {
    const parsed = ComponentBuildSpecSchema.parse(component);
    expect(parsed.agent.maxRepairTurns).toBe(3);
  });

  it("rejects Figma URLs without a node id", () => {
    const result = ComponentBuildSpecSchema.safeParse({
      ...component,
      design: { ...component.design, mobileFrameUrl: "https://www.figma.com/design/file/Foundry" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate component slugs in a batch", () => {
    const result = BatchBuildSpecSchema.safeParse({
      schemaVersion: 1,
      runId: "run-1",
      projectId: "project-1",
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: [component, { ...component, componentId: "hero-2" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("project foundation contracts", () => {
  it("requires both a style guide and Container when ready", () => {
    const result = ProjectFoundationSchema.safeParse({
      schemaVersion: 1,
      projectId: "project-1",
      status: "ready",
      sourceCommit: sha,
      fingerprint,
      reasons: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects paths that escape the project", () => {
    expect(RelativeProjectPathSchema.safeParse("../secret").success).toBe(false);
    expect(RelativeProjectPathSchema.safeParse("components/sections/Hero.tsx").success).toBe(true);
  });
});
