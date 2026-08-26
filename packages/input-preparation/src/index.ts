import { ContentfulAdapter } from "@foundry/cms-contentful";
import { ContentstackAdapter } from "@foundry/cms-contentstack";
import { CmsAdapterRegistry, type CmsInspection } from "@foundry/cms-core";
import {
  CmsSchemaSnapshotSchema,
  ComponentPlanSchema,
  FieldBindingPlanSchema,
  PreparedComponentInputSchema,
  PreparedComponentInputsSchema,
  type ArtifactRef,
  type BatchDeliveryRequest,
  type CmsFieldSnapshot,
  type ComponentBuildSpec,
  type ComponentPlan,
  type FieldBindingPlan,
  type PreparedComponentInput,
  type PreparedComponentInputs,
} from "@foundry/contracts";
import { FigmaDesignIngestor, type IngestedDesign } from "@foundry/design";
import { InputArtifactStore, InputPreparationError, contentDigest } from "@foundry/input-core";
import { resolve } from "node:path";

export interface PreparedBatch {
  readonly inputs: PreparedComponentInputs;
  readonly artifacts: readonly ArtifactRef[];
}

export interface InputPreparer {
  prepare(request: BatchDeliveryRequest, signal?: AbortSignal): Promise<PreparedBatch>;
}

export interface BatchInputPreparerOptions {
  readonly cmsAdapters?: CmsAdapterRegistry;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: () => Date;
}

function renderHint(
  field: CmsFieldSnapshot,
): "text" | "rich-text" | "image" | "link" | "collection" | "structured-data" {
  if (field.cardinality === "many") return "collection";
  if (field.kind === "rich-text") return "rich-text";
  if (field.kind === "asset") return "image";
  if (field.kind === "reference") return "link";
  if (["json", "group", "blocks", "location", "unknown"].includes(field.kind))
    return "structured-data";
  return "text";
}

function transformFor(field: CmsFieldSnapshot): string | undefined {
  if (field.kind === "rich-text") return "renderRichText";
  if (field.kind === "asset") return "mapAsset";
  if (field.kind === "reference") return "mapReference";
  if (field.cardinality === "many") return "mapCollection";
  return undefined;
}

function buildBindingCore(specification: ComponentBuildSpec, cms: CmsInspection) {
  const bindings = cms.fields.map((field) => ({
    cmsField: field.path,
    graphqlPath: field.graphqlField,
    propPath: field.graphqlField,
    cardinality: field.cardinality,
    required: field.required,
    ...(transformFor(field) ? { transform: transformFor(field) } : {}),
    sourceKind: field.kind,
    renderHint: renderHint(field),
  }));
  return {
    schemaVersion: 1 as const,
    componentId: specification.componentId,
    cmsType: specification.cms.contentType,
    bindings,
    uncoveredFields: [] as string[],
  };
}

function normalizeColor(value: string): string {
  return value.trim().toUpperCase();
}

function cssPixels(value: string): number | undefined {
  const match = /^([0-9]+(?:\.[0-9]+)?)px$/.exec(value.trim());
  return match?.[1] ? Number(match[1]) : undefined;
}

function componentPlanCore(
  request: BatchDeliveryRequest,
  specification: ComponentBuildSpec,
  design: IngestedDesign,
  cms: CmsInspection,
) {
  const componentRoot = `${request.project.paths.sectionRoot}/${specification.slug}`;
  const matchedColorTokens = request.foundation.styleGuide.colors
    .filter((token) =>
      design.snapshot.desktop.colors
        .concat(design.snapshot.mobile.colors)
        .some(({ value }) => normalizeColor(value) === normalizeColor(token.value)),
    )
    .map(({ name }) => name);
  const typography = design.snapshot.desktop.typography.concat(design.snapshot.mobile.typography);
  const matchedTypographyTokens = request.foundation.styleGuide.typography
    .filter((token) =>
      typography.some(
        (item) =>
          item.fontFamily.toLowerCase() === token.fontFamily.toLowerCase() &&
          item.fontWeight === token.fontWeight &&
          cssPixels(token.fontSize) === item.fontSize,
      ),
    )
    .map(({ name }) => name);
  const issues: Array<{ code: string; severity: "warning" | "review-required"; message: string }> =
    [];
  if (design.snapshot.desktop.width <= design.snapshot.mobile.width) {
    issues.push({
      code: "AMBIGUOUS_BREAKPOINT_ORDER",
      severity: "review-required",
      message: "The desktop frame is not wider than the mobile frame.",
    });
  }
  if (!cms.fields.some(({ path }) => path === specification.cms.variantField)) {
    issues.push({
      code: "VARIANT_FIELD_NOT_FOUND",
      severity: "review-required",
      message: `Mapped variant field ${specification.cms.variantField} is absent from the CMS schema.`,
    });
  }
  if (matchedColorTokens.length === 0 && design.snapshot.desktop.colors.length > 0) {
    issues.push({
      code: "NO_COLOR_TOKEN_MATCH",
      severity: "warning",
      message:
        "No exact project color token matches were found; the agent must reuse the nearest existing token.",
    });
  }
  if (matchedTypographyTokens.length === 0 && typography.length > 0) {
    issues.push({
      code: "NO_TYPOGRAPHY_TOKEN_MATCH",
      severity: "warning",
      message:
        "No exact typography token matches were found; the agent must use the existing type scale.",
    });
  }
  const componentPath = `${componentRoot}/index.tsx`;
  const typesPath = `${componentRoot}/types.ts`;
  const transformPath = `${componentRoot}/transform.ts`;
  const fragmentPath = `${componentRoot}/${specification.slug}.fragment.graphql`;
  const manifestPath = `${componentRoot}/section.manifest.json`;
  return {
    schemaVersion: 1 as const,
    componentId: specification.componentId,
    status: issues.some(({ severity }) => severity === "review-required")
      ? ("review-required" as const)
      : ("ready" as const),
    componentPath,
    typesPath,
    transformPath,
    fragmentPath,
    manifestPath,
    fragmentName: `${specification.name.replace(/[^A-Za-z0-9]/g, "")}Fragment`,
    registryKey: `${specification.cms.contentType}:${specification.cms.variantValue}`,
    allowedFiles: [componentPath, typesPath, transformPath, fragmentPath, manifestPath],
    reusableComponents: [
      request.foundation.container.componentPath,
      ...request.foundation.styleGuide.primitives.map(({ path }) => path),
    ],
    matchedColorTokens,
    matchedTypographyTokens,
    responsiveStrategy: [
      `Implement the ${design.snapshot.mobile.width}px mobile frame as the base layout.`,
      `Adapt to the ${design.snapshot.desktop.width}px desktop frame using project breakpoints.`,
      `Wrap contained content with ${request.foundation.container.importPath}; preserve full bleed only when supported.`,
    ],
    issues,
  };
}

export class BatchInputPreparer implements InputPreparer {
  readonly #registry: CmsAdapterRegistry;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #fetch: typeof globalThis.fetch | undefined;
  readonly #clock: () => Date;

  constructor(options: BatchInputPreparerOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#fetch = options.fetch;
    this.#clock = options.clock ?? (() => new Date());
    this.#registry =
      options.cmsAdapters ??
      new CmsAdapterRegistry([
        new ContentfulAdapter({
          environment: this.#environment,
          ...(this.#fetch ? { fetch: this.#fetch } : {}),
        }),
        new ContentstackAdapter({
          environment: this.#environment,
          ...(this.#fetch ? { fetch: this.#fetch } : {}),
        }),
      ]);
  }

  async prepare(request: BatchDeliveryRequest, signal?: AbortSignal): Promise<PreparedBatch> {
    if (!request.inputPreparation.enabled) return { inputs: {}, artifacts: [] };
    const token = this.#environment[request.inputPreparation.figmaTokenEnv];
    if (!token) {
      throw new InputPreparationError({
        code: "FIGMA_CREDENTIALS_MISSING",
        message: `Missing Figma token environment variable ${request.inputPreparation.figmaTokenEnv}`,
      });
    }
    const outputRoot = resolve(
      request.inputPreparation.outputRoot ??
        resolve(request.worktreeRoot, request.batch.runId, "inputs"),
    );
    const store = new InputArtifactStore({ rootDirectory: outputRoot, clock: this.#clock });
    const ingestor = new FigmaDesignIngestor({
      token,
      outputRoot,
      timeoutMs: request.inputPreparation.requestTimeoutMs,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
      clock: this.#clock,
    });
    const components = request.batch.components;
    const preparedComponents = new Array<PreparedComponentInput | undefined>(components.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < components.length) {
        const index = cursor++;
        const specification = components[index];
        if (!specification) return;
        preparedComponents[index] = await this.#prepareComponent(
          request,
          specification,
          ingestor,
          store,
          signal,
        );
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(request.batch.maxParallel, components.length) }, worker),
    );
    const inputs: Record<string, PreparedComponentInput> = {};
    const artifacts: ArtifactRef[] = [];
    components.forEach((component, index) => {
      const prepared = preparedComponents[index];
      if (!prepared) {
        throw new InputPreparationError({
          code: "INPUT_PREPARATION_INCOMPLETE",
          message: `No prepared input was produced for ${component.componentId}`,
        });
      }
      inputs[component.componentId] = prepared;
      artifacts.push(...prepared.artifacts);
    });
    return { inputs: PreparedComponentInputsSchema.parse(inputs), artifacts };
  }

  async #prepareComponent(
    request: BatchDeliveryRequest,
    specification: ComponentBuildSpec,
    ingestor: FigmaDesignIngestor,
    store: InputArtifactStore,
    signal?: AbortSignal,
  ): Promise<PreparedComponentInput> {
    const [design, cms] = await Promise.all([
      ingestor.ingest(specification, signal),
      this.#registry.resolve(specification.cms.provider).inspect(specification.cms, {
        fetchSampleEntry: request.inputPreparation.fetchSampleEntry,
        timeoutMs: request.inputPreparation.requestTimeoutMs,
        ...(signal ? { signal } : {}),
      }),
    ]);
    if (cms.fields.length === 0) {
      throw new InputPreparationError({
        code: "CMS_SCHEMA_EMPTY",
        message: `CMS content type ${specification.cms.contentType} has no fields`,
      });
    }
    const schemaArtifact = await store.writeJson({
      componentId: specification.componentId,
      kind: "other",
      label: "cms-schema",
      value: cms.rawSchema,
    });
    const sampleEntryArtifact =
      cms.sampleEntry === undefined
        ? undefined
        : await store.writeJson({
            componentId: specification.componentId,
            kind: "other",
            label: "cms-sample-entry",
            value: cms.sampleEntry,
          });
    const cmsSnapshot = CmsSchemaSnapshotSchema.parse({
      schemaVersion: 1,
      provider: cms.provider,
      contentType: cms.contentType,
      name: cms.name,
      graphqlType: cms.graphqlType,
      capturedAt: this.#clock().toISOString(),
      digest: contentDigest({
        provider: cms.provider,
        contentType: cms.contentType,
        fields: cms.fields,
      }),
      fields: cms.fields,
      schemaArtifact,
      ...(sampleEntryArtifact ? { sampleEntryArtifact } : {}),
    });
    const bindingCore = buildBindingCore(specification, cms);
    const bindingArtifact = await store.writeJson({
      componentId: specification.componentId,
      kind: "manifest",
      label: "field-binding-plan",
      value: bindingCore,
    });
    const bindings: FieldBindingPlan = FieldBindingPlanSchema.parse({
      ...bindingCore,
      digest: contentDigest(bindingCore),
      artifact: bindingArtifact,
    });
    const planCore = componentPlanCore(request, specification, design, cms);
    const planArtifact = await store.writeJson({
      componentId: specification.componentId,
      kind: "manifest",
      label: "component-plan",
      value: planCore,
    });
    const plan: ComponentPlan = ComponentPlanSchema.parse({
      ...planCore,
      digest: contentDigest(planCore),
      artifact: planArtifact,
    });
    if (plan.status === "review-required" && request.inputPreparation.failOnReview) {
      throw new InputPreparationError({
        code: "INPUT_REVIEW_REQUIRED",
        message: `Input preparation for ${specification.name} requires review`,
        details: { componentId: specification.componentId, issues: plan.issues },
      });
    }
    const allArtifacts = [
      design.snapshotArtifact,
      ...design.snapshot.artifacts,
      schemaArtifact,
      ...(sampleEntryArtifact ? [sampleEntryArtifact] : []),
      bindingArtifact,
      planArtifact,
    ];
    return PreparedComponentInputSchema.parse({
      schemaVersion: 1,
      componentId: specification.componentId,
      design: design.snapshot,
      cms: cmsSnapshot,
      bindings,
      plan,
      artifacts: allArtifacts,
    });
  }
}

export function createEnvironmentInputPreparer(): BatchInputPreparer {
  return new BatchInputPreparer();
}
