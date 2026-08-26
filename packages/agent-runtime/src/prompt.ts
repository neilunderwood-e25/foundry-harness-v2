import type {
  ComponentBuildSpec,
  PreparedComponentInput,
  ProjectProfile,
  ReadyProjectFoundation,
  VerificationReport,
} from "@foundry/contracts";

export interface ComponentPromptInput {
  readonly specification: ComponentBuildSpec;
  readonly project: ProjectProfile;
  readonly foundation: ReadyProjectFoundation;
  readonly preparedInput?: PreparedComponentInput;
}

export function buildComponentPrompt(input: ComponentPromptInput): string {
  const { specification, project, foundation, preparedInput } = input;
  const componentRoot = `${project.paths.sectionRoot}/${specification.slug}`;
  const manifestPath = `${componentRoot}/section.manifest.json`;

  return `You are implementing one production Next.js section in an isolated Git worktree.

Outcome:
- Build the ${specification.name} section from the paired Figma frames.
- Bind it to the mapped ${specification.cms.provider} content type.
- Create the component, component-scoped GraphQL fragment, data transform, and SectionManifest.
- Put data-foundry="${specification.slug}" on the section's root element for harness QA.
- Finish only when the component-scoped implementation is internally consistent.

Inputs:
${JSON.stringify(
  {
    component: {
      id: specification.componentId,
      name: specification.name,
      slug: specification.slug,
    },
    design: specification.design,
    cms: specification.cms,
    project: {
      framework: project.framework,
      packageManager: project.packageManager,
      sectionRoot: project.paths.sectionRoot,
    },
    foundation: {
      fingerprint: foundation.fingerprint,
      styleGuide: foundation.styleGuide,
      container: foundation.container,
    },
    ...(preparedInput
      ? {
          preparedInput: {
            design: {
              digest: preparedInput.design.digest,
              desktop: {
                width: preparedInput.design.desktop.width,
                height: preparedInput.design.desktop.height,
                colors: preparedInput.design.desktop.colors,
                typography: preparedInput.design.desktop.typography,
                screenshot: preparedInput.design.desktop.screenshot.path,
              },
              mobile: {
                width: preparedInput.design.mobile.width,
                height: preparedInput.design.mobile.height,
                colors: preparedInput.design.mobile.colors,
                typography: preparedInput.design.mobile.typography,
                screenshot: preparedInput.design.mobile.screenshot.path,
              },
            },
            cms: {
              provider: preparedInput.cms.provider,
              contentType: preparedInput.cms.contentType,
              graphqlType: preparedInput.cms.graphqlType,
              fields: preparedInput.cms.fields,
              schemaArtifact: preparedInput.cms.schemaArtifact.path,
              sampleEntryArtifact: preparedInput.cms.sampleEntryArtifact?.path,
            },
            bindings: preparedInput.bindings.bindings,
            plan: {
              status: preparedInput.plan.status,
              componentPath: preparedInput.plan.componentPath,
              typesPath: preparedInput.plan.typesPath,
              transformPath: preparedInput.plan.transformPath,
              fragmentPath: preparedInput.plan.fragmentPath,
              manifestPath: preparedInput.plan.manifestPath,
              fragmentName: preparedInput.plan.fragmentName,
              reusableComponents: preparedInput.plan.reusableComponents,
              matchedColorTokens: preparedInput.plan.matchedColorTokens,
              matchedTypographyTokens: preparedInput.plan.matchedTypographyTokens,
              responsiveStrategy: preparedInput.plan.responsiveStrategy,
              issues: preparedInput.plan.issues,
            },
            artifacts: preparedInput.artifacts.map(({ kind, path, mediaType }) => ({
              kind,
              path,
              mediaType,
            })),
          },
        }
      : {}),
  },
  null,
  2,
)}

Ownership and safety:
- You may create or edit files only under ${componentRoot}.
- Write the SectionManifest to ${manifestPath}.
- Do not edit the project Style Guide, Container, registry, page query, lockfiles, package manifest, or configuration files.
- Reuse the frozen design tokens, typography, primitives, and Container contract above.
- Treat the prepared design, CMS, binding, and component plans as the source of truth when supplied.
- Read prepared artifact files only as evidence; never modify them or expose CMS credentials.
- Do not commit, merge, rebase, or create branches. The harness owns Git lifecycle.
- Do not use placeholder CMS data in the production component.

The manifest must be valid JSON with schemaVersion 1 and include componentId, componentPath, cmsType, variant, fragmentPath, fragmentName, transformPath, registryKey, bindings, and ownedFiles.`;
}

export function buildRepairPrompt(report: VerificationReport, componentRoot: string): string {
  const failures = report.gates
    .filter(({ status }) => status === "failed")
    .map(({ id, label, detail }) => ({ id, label, detail: detail ?? "No detail provided" }));

  return `The harness rejected verification attempt ${report.attempt}.

Fix every failed gate below, then stop. Re-run focused checks when useful.

${JSON.stringify(failures, null, 2)}

Ownership remains unchanged:
- Edit only files under ${componentRoot}.
- Keep section.manifest.json accurate, including ownedFiles and CMS bindings.
- Use the referenced screenshots, visual diffs, and accessibility reports as evidence when present.
- Do not commit, merge, rebase, or edit shared project files. The harness owns Git and integration.`;
}
