import type {
  BatchDeliveryRequest,
  DurableJob,
  DurableRun,
  DurableRunSnapshot,
  DurableRunStatus,
} from "@foundry/contracts";

export const terminalStatuses = new Set<DurableRunStatus>([
  "completed",
  "passed",
  "failed",
  "partial",
  "cancelled",
  "interrupted",
]);

export function isActiveStatus(status: DurableRunStatus): boolean {
  return !terminalStatuses.has(status);
}

export function deliveryRequest(run: DurableRun): BatchDeliveryRequest | undefined {
  if (!run.request || typeof run.request !== "object") return undefined;
  const value = run.request as Partial<BatchDeliveryRequest>;
  return value.schemaVersion === 1 && value.batch && value.project
    ? (value as BatchDeliveryRequest)
    : undefined;
}

export function componentName(snapshot: DurableRunSnapshot, job: DurableJob): string {
  const request = deliveryRequest(snapshot.run);
  return (
    request?.batch.components.find(({ componentId }) => componentId === job.componentId)?.name ??
    job.componentId
  );
}

export function componentProvider(
  snapshot: DurableRunSnapshot,
  job: DurableJob,
): string | undefined {
  const request = deliveryRequest(snapshot.run);
  return request?.batch.components.find(({ componentId }) => componentId === job.componentId)?.agent
    .provider;
}

export function runProgress(snapshot: DurableRunSnapshot): number {
  if (snapshot.run.status === "passed" || snapshot.run.status === "completed") return 100;
  if (snapshot.jobs.length === 0) return snapshot.run.status === "queued" ? 2 : 8;
  const weight: Record<DurableJob["status"], number> = {
    queued: 0.08,
    running: 0.45,
    completed: 0.72,
    passed: 1,
    failed: 1,
    cancelled: 1,
  };
  const jobProgress =
    snapshot.jobs.reduce((total, job) => total + weight[job.status], 0) / snapshot.jobs.length;
  const integration = snapshot.steps.find(({ phase }) => phase === "integration");
  const integrationProgress = integration?.status === "completed" ? 1 : integration ? 0.5 : 0;
  return Math.round(Math.min(0.9 * jobProgress + 0.1 * integrationProgress, 1) * 100);
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const delta = Math.max(0, now - new Date(value).getTime());
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDuration(start?: string, end?: string, now = Date.now()): string {
  if (!start) return "—";
  const milliseconds = Math.max(
    0,
    (end ? new Date(end).getTime() : now) - new Date(start).getTime(),
  );
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function shortId(value: string, maximum = 26): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

export function parseDeliveryDocument(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("batch" in parsed)) {
    throw new Error("Expected a delivery document with a batch property");
  }
  return parsed;
}
