import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  ArtifactRefSchema,
  VerificationGateSchema,
  type ArtifactRef,
  type VerificationGate,
} from "@foundry/contracts";
import { PlaywrightBrowserInspector } from "./browser.js";
import { QualityError } from "./errors.js";
import { FigmaRestReferenceProvider } from "./figma.js";
import { PngImageComparator } from "./images.js";
import { ProjectPreviewServer } from "./preview.js";
import type {
  BrowserInspector,
  DesignReferenceProvider,
  ImageComparator,
  PreviewServer,
  QualityGateProvider,
  QualityVerificationInput,
} from "./types.js";

export interface VisualAccessibilityVerifierOptions {
  readonly references?: DesignReferenceProvider;
  readonly preview?: PreviewServer;
  readonly browser?: BrowserInspector;
  readonly comparator?: ImageComparator;
  readonly clock?: () => Date;
}

const IMPACT = { minor: 1, moderate: 2, serious: 3, critical: 4 } as const;

function renderTemplate(template: string, slug: string): string {
  return template.replaceAll("{slug}", slug);
}

function safeSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!segment) {
    throw new QualityError({
      code: "INVALID_ARTIFACT_SEGMENT",
      message: `Cannot create an artifact path from ${value}`,
    });
  }
  return segment;
}

function artifact(
  input: QualityVerificationInput,
  id: string,
  kind: ArtifactRef["kind"],
  path: string,
  mediaType: string,
  clock: () => Date,
): ArtifactRef {
  return ArtifactRefSchema.parse({
    artifactId: `${input.request.batch.runId}:${input.specification.componentId}:${input.attempt}:${id}`,
    kind,
    path,
    mediaType,
    createdAt: clock().toISOString(),
  });
}

export class VisualAccessibilityVerifier implements QualityGateProvider {
  readonly #references: DesignReferenceProvider;
  readonly #preview: PreviewServer;
  readonly #browser: BrowserInspector;
  readonly #comparator: ImageComparator;
  readonly #clock: () => Date;

  constructor(options: VisualAccessibilityVerifierOptions = {}) {
    this.#references = options.references ?? new FigmaRestReferenceProvider();
    this.#preview = options.preview ?? new ProjectPreviewServer();
    this.#browser = options.browser ?? new PlaywrightBrowserInspector();
    this.#comparator = options.comparator ?? new PngImageComparator();
    this.#clock = options.clock ?? (() => new Date());
  }

  async verify(input: QualityVerificationInput): Promise<VerificationGate[]> {
    const policy = input.request.quality;
    if (!policy.enabled) {
      return [
        VerificationGateSchema.parse({
          id: "quality",
          label: "Visual and accessibility QA",
          category: "visual",
          status: "skipped",
          detail: "Disabled by quality policy",
          artifacts: [],
        }),
      ];
    }
    const componentArtifactDirectory = resolve(
      input.request.worktreeRoot,
      safeSegment(input.request.batch.runId),
      "artifacts",
      safeSegment(input.specification.componentId),
    );
    const outputDirectory = resolve(componentArtifactDirectory, `attempt-${input.attempt}`);
    const referenceDirectory = resolve(componentArtifactDirectory, "references");
    await mkdir(outputDirectory, { recursive: true });
    let preview;
    try {
      const references = await this.#references.exportReferences({
        specification: input.specification,
        outputDirectory: referenceDirectory,
        tokenEnvironmentVariable: policy.figmaTokenEnv,
        timeoutMs: policy.navigationTimeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      preview = await this.#preview.start({
        workingDirectory: input.worktree.workingDirectory,
        command: input.request.project.commands.dev,
        timeoutMs: policy.startupTimeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const route = renderTemplate(policy.routeTemplate, input.specification.slug);
      const selector = renderTemplate(policy.selectorTemplate, input.specification.slug);
      const inspection = await this.#browser.inspect({
        url: new URL(route, preview.baseUrl).href,
        selector,
        references,
        outputDirectory,
        navigationTimeoutMs: policy.navigationTimeoutMs,
        runAccessibility: policy.runAccessibility,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const gates: VerificationGate[] = [];
      for (const reference of references) {
        const capture = inspection.captures.find(({ label }) => label === reference.label);
        if (!capture) {
          throw new QualityError({
            code: "SCREENSHOT_MISSING",
            message: `No ${reference.label} screenshot was captured`,
            repairable: true,
          });
        }
        const diffPath = resolve(outputDirectory, `${reference.label}-diff.png`);
        const comparison = await this.#comparator.compare({
          referencePath: reference.path,
          actualPath: capture.path,
          diffPath,
          pixelThreshold: policy.pixelThreshold,
        });
        const artifacts = [
          artifact(
            input,
            `${reference.label}:reference`,
            "design",
            reference.path,
            "image/png",
            this.#clock,
          ),
          artifact(
            input,
            `${reference.label}:actual`,
            "screenshot",
            capture.path,
            "image/png",
            this.#clock,
          ),
          artifact(
            input,
            `${reference.label}:diff`,
            "visual-diff",
            diffPath,
            "image/png",
            this.#clock,
          ),
        ];
        gates.push(
          VerificationGateSchema.parse({
            id: `visual:${reference.label}`,
            label: `${reference.label} visual parity`,
            category: "visual",
            status: comparison.ratio <= policy.maxDiffRatio ? "passed" : "failed",
            repairable: true,
            detail:
              `${(comparison.ratio * 100).toFixed(2)}% pixel difference; ` +
              `limit ${(policy.maxDiffRatio * 100).toFixed(2)}%. ` +
              `Reference ${comparison.referenceSize.width}x${comparison.referenceSize.height}, ` +
              `actual ${comparison.actualSize.width}x${comparison.actualSize.height}.`,
            artifacts,
          }),
        );
      }
      gates.push(
        VerificationGateSchema.parse({
          id: "reflow",
          label: `Responsive reflow at ${inspection.reflow.width}px`,
          category: "visual",
          status: inspection.reflow.ok ? "passed" : "failed",
          repairable: true,
          detail: inspection.reflow.detail,
          artifacts: [],
        }),
      );

      if (policy.runAccessibility) {
        const threshold = IMPACT[policy.minimumAccessibilityImpact];
        const blocking = inspection.accessibility.filter(
          ({ impact }) => impact !== null && IMPACT[impact] >= threshold,
        );
        const reportPath = resolve(outputDirectory, "accessibility.json");
        await writeFile(reportPath, JSON.stringify(inspection.accessibility, null, 2));
        gates.push(
          VerificationGateSchema.parse({
            id: "accessibility",
            label: "Automated accessibility",
            category: "accessibility",
            status: blocking.length === 0 ? "passed" : "failed",
            repairable: true,
            detail:
              blocking.length === 0
                ? `No ${policy.minimumAccessibilityImpact}-or-higher violations`
                : blocking
                    .map(({ id, impact, nodes }) => `${id} (${impact}, ${nodes.length} nodes)`)
                    .join("; "),
            artifacts: [
              artifact(
                input,
                "accessibility",
                "report",
                reportPath,
                "application/json",
                this.#clock,
              ),
            ],
          }),
        );
      }
      return gates;
    } catch (error) {
      const failure =
        error instanceof QualityError
          ? error
          : new QualityError({
              code: "QUALITY_VERIFICATION_FAILED",
              message: error instanceof Error ? error.message : String(error),
              cause: error,
            });
      const logPath = resolve(outputDirectory, "quality-error.log");
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(
        logPath,
        `${failure.code}: ${failure.message}\n${preview?.logs() ?? ""}`,
        "utf8",
      );
      return [
        VerificationGateSchema.parse({
          id: "quality-infrastructure",
          label: "Visual QA infrastructure",
          category: "runtime",
          status: "failed",
          repairable: failure.repairable,
          detail: `${failure.code}: ${failure.message}`,
          artifacts: [artifact(input, "quality-error", "log", logPath, "text/plain", this.#clock)],
        }),
      ];
    } finally {
      await preview?.stop();
    }
  }
}
