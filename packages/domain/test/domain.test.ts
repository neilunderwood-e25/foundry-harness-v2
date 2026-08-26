import { describe, expect, it } from "vitest";
import type {
  BatchBuildSpec,
  ComponentBuildSpec,
  ProjectFoundation,
  ReadyProjectFoundation,
} from "@foundry/contracts";
import { assertFoundationMatchesBuild, DomainError, planBatchJobs } from "../src/index.js";

const sha = "a".repeat(40);
const fingerprint = "b".repeat(64);

const styleGuide: ReadyProjectFoundation["styleGuide"] = {
  source: "existing",
  files: ["styles/tokens.css"],
  colors: [],
  spacing: [],
  typography: [],
  breakpoints: { md: 768, xl: 1280 },
  primitives: [],
};

const container: ReadyProjectFoundation["container"] = {
  source: "existing",
  componentPath: "components/ui/Container.tsx",
  importPath: "@/components/ui/Container",
  desktopMaxWidth: 1440,
  mobileMaxWidth: "fluid",
  paddingByBreakpoint: {
    base: { top: 0, right: 16, bottom: 0, left: 16 },
  },
  supportsFullBleed: true,
  supportedProps: ["children", "className"],
};

const foundation: ReadyProjectFoundation = {
  schemaVersion: 1,
  projectId: "project-1" as ReadyProjectFoundation["projectId"],
  status: "ready",
  sourceCommit: sha,
  fingerprint,
  reasons: [],
  styleGuide,
  container,
};

const specification: ComponentBuildSpec = {
  schemaVersion: 1,
  runId: "release-42" as ComponentBuildSpec["runId"],
  componentId: "hero" as ComponentBuildSpec["componentId"],
  projectId: foundation.projectId,
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
  agent: { provider: "codex", maxRepairTurns: 3 },
};

describe("foundation invariants", () => {
  it("accepts a build frozen to the same foundation", () => {
    expect(assertFoundationMatchesBuild(foundation, specification)).toBe(foundation);
  });

  it("blocks a stale foundation", () => {
    const stale: ProjectFoundation = {
      ...foundation,
      status: "stale",
      previousFingerprint: foundation.fingerprint,
      reasons: ["tokens changed"],
    };

    expect(() => assertFoundationMatchesBuild(stale, specification)).toThrowError(DomainError);
  });

  it("blocks a changed foundation fingerprint", () => {
    expect(() =>
      assertFoundationMatchesBuild(foundation, {
        ...specification,
        foundationFingerprint: "c".repeat(64),
      }),
    ).toThrowError(/foundation changed/i);
  });
});

describe("batch planning", () => {
  it("creates deterministic, component-scoped branches", () => {
    const second = {
      ...specification,
      componentId: "cards" as ComponentBuildSpec["componentId"],
      name: "Cards",
      slug: "cards",
    };
    const batch: BatchBuildSpec = {
      schemaVersion: 1,
      runId: specification.runId,
      projectId: specification.projectId,
      baseCommit: sha,
      foundationFingerprint: fingerprint,
      maxParallel: 2,
      components: [specification, second],
    };

    expect(planBatchJobs(batch).map((job) => job.branch)).toEqual([
      "foundry/release-42/hero",
      "foundry/release-42/cards",
    ]);
  });
});
