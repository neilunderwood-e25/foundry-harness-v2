import {
  ProjectFoundationSchema,
  type ProjectFoundation,
  type ProjectProfile,
} from "@foundry/contracts";
import { detectContainer } from "./container.js";
import { foundationFingerprint } from "./fingerprint.js";
import { detectStyleGuide } from "./style-guide.js";

export interface InspectFoundationOptions {
  previous?: ProjectFoundation;
  acceptChanges?: boolean;
}

export async function inspectProjectFoundation(
  profile: ProjectProfile,
  options: InspectFoundationOptions = {},
): Promise<ProjectFoundation> {
  const [styleGuide, container] = await Promise.all([
    detectStyleGuide(profile),
    detectContainer(profile),
  ]);
  const reasons = [...styleGuide.reasons, ...container.reasons];

  if (!styleGuide.profile || !container.profile) {
    return ProjectFoundationSchema.parse({
      schemaVersion: 1,
      projectId: profile.projectId,
      status: "missing",
      reasons,
      ...(styleGuide.profile ? { styleGuide: styleGuide.profile } : {}),
      ...(container.profile ? { container: container.profile } : {}),
    });
  }

  const fingerprint = await foundationFingerprint(
    profile.rootDir,
    styleGuide.profile,
    container.profile,
  );
  if (
    options.previous?.status === "ready" &&
    options.previous.fingerprint !== fingerprint &&
    !options.acceptChanges
  ) {
    return ProjectFoundationSchema.parse({
      schemaVersion: 1,
      projectId: profile.projectId,
      status: "stale",
      sourceCommit: profile.inspectedCommit,
      previousFingerprint: options.previous.fingerprint,
      reasons: ["Style Guide or Container files changed after the foundation was frozen"],
      styleGuide: styleGuide.profile,
      container: container.profile,
    });
  }

  return ProjectFoundationSchema.parse({
    schemaVersion: 1,
    projectId: profile.projectId,
    status: "ready",
    sourceCommit: profile.inspectedCommit,
    fingerprint,
    reasons: [],
    styleGuide: styleGuide.profile,
    container: container.profile,
  });
}
