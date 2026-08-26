import type {
  ComponentBuildSpec,
  ProjectProfile,
  ReadyProjectFoundation,
} from "@foundry/contracts";

export interface ComponentPromptInput {
  readonly specification: ComponentBuildSpec;
  readonly project: ProjectProfile;
  readonly foundation: ReadyProjectFoundation;
}

export function buildComponentPrompt(input: ComponentPromptInput): string {
  const { specification, project, foundation } = input;
  const componentRoot = `${project.paths.sectionRoot}/${specification.slug}`;
  const manifestPath = `${componentRoot}/section.manifest.json`;

  return `You are implementing one production Next.js section in an isolated Git worktree.

Outcome:
- Build the ${specification.name} section from the paired Figma frames.
- Bind it to the mapped ${specification.cms.provider} content type.
- Create the component, component-scoped GraphQL fragment, data transform, and SectionManifest.
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
  },
  null,
  2,
)}

Ownership and safety:
- You may create or edit files only under ${componentRoot}.
- Write the SectionManifest to ${manifestPath}.
- Do not edit the project Style Guide, Container, registry, page query, lockfiles, package manifest, or configuration files.
- Reuse the frozen design tokens, typography, primitives, and Container contract above.
- Do not commit, merge, rebase, or create branches. The harness owns Git lifecycle.
- Do not use placeholder CMS data in the production component.

The manifest must be valid JSON with schemaVersion 1 and include componentId, componentPath, cmsType, variant, fragmentPath, fragmentName, transformPath, registryKey, bindings, and ownedFiles.`;
}
