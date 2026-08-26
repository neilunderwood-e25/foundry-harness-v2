import type { BatchExecutionRequest } from "@foundry/contracts";
import { assertFoundationMatchesBuild, DomainError } from "@foundry/domain";

export function assertBatchExecutionReady(request: BatchExecutionRequest): void {
  const { project, foundation, batch } = request;
  if (project.projectId !== batch.projectId || foundation.projectId !== batch.projectId) {
    throw new DomainError("PROJECT_MISMATCH", "Project, foundation, and batch must match");
  }
  if (
    project.inspectedCommit !== batch.baseCommit ||
    foundation.sourceCommit !== batch.baseCommit
  ) {
    throw new DomainError(
      "BASE_COMMIT_MISMATCH",
      "Project, foundation, and batch must use the same base commit",
    );
  }
  if (foundation.fingerprint !== batch.foundationFingerprint) {
    throw new DomainError(
      "FOUNDATION_FINGERPRINT_MISMATCH",
      "Batch does not use the frozen project foundation",
    );
  }
  for (const component of batch.components) {
    assertFoundationMatchesBuild(foundation, component);
  }
}
