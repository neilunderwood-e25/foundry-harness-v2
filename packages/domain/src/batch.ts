import type { BatchBuildSpec, ComponentBuildSpec } from "@foundry/contracts";

export interface ComponentJobPlan {
  readonly runId: string;
  readonly componentId: string;
  readonly slug: string;
  readonly branch: string;
  readonly queueIndex: number;
  readonly specification: ComponentBuildSpec;
}

function branchSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function planBatchJobs(batch: BatchBuildSpec): ComponentJobPlan[] {
  const runSegment = branchSegment(batch.runId);

  return batch.components.map((specification, queueIndex) => ({
    runId: batch.runId,
    componentId: specification.componentId,
    slug: specification.slug,
    branch: `foundry/${runSegment}/${specification.slug}`,
    queueIndex,
    specification,
  }));
}
