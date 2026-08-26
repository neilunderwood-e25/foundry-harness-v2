import type {
  ComponentBuildSpec,
  ProjectFoundation,
  ReadyProjectFoundation,
} from "@foundry/contracts";
import { DomainError } from "./errors.js";

export function requireReadyFoundation(foundation: ProjectFoundation): ReadyProjectFoundation {
  if (foundation.status !== "ready") {
    throw new DomainError(
      "FOUNDATION_NOT_READY",
      `Project foundation is ${foundation.status}; style guide and Container must be ready`,
      { projectId: foundation.projectId, status: foundation.status, reasons: foundation.reasons },
    );
  }

  return foundation;
}

export function assertFoundationMatchesBuild(
  foundationInput: ProjectFoundation,
  specification: ComponentBuildSpec,
): ReadyProjectFoundation {
  const foundation = requireReadyFoundation(foundationInput);

  if (foundation.projectId !== specification.projectId) {
    throw new DomainError("FOUNDATION_PROJECT_MISMATCH", "Foundation belongs to another project", {
      expected: specification.projectId,
      actual: foundation.projectId,
    });
  }

  if (foundation.fingerprint !== specification.foundationFingerprint) {
    throw new DomainError(
      "FOUNDATION_FINGERPRINT_MISMATCH",
      "Project foundation changed after this build was specified",
      { expected: specification.foundationFingerprint, actual: foundation.fingerprint },
    );
  }

  if (foundation.sourceCommit !== specification.baseCommit) {
    throw new DomainError(
      "FOUNDATION_COMMIT_MISMATCH",
      "Project foundation was not frozen at the build's base commit",
      { expected: specification.baseCommit, actual: foundation.sourceCommit },
    );
  }

  return foundation;
}
