import type { DurableRunStatus } from "@foundry/contracts";

const labels: Record<DurableRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  cancelling: "Cancelling",
  completed: "Completed",
  passed: "Passed",
  failed: "Failed",
  partial: "Partial",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export function StatusBadge({
  status,
  compact = false,
}: {
  status: DurableRunStatus;
  compact?: boolean;
}) {
  return (
    <span className={`status-badge status-${status}${compact ? " status-compact" : ""}`}>
      <span className="status-dot" />
      {labels[status]}
    </span>
  );
}

export function JobStatus({ status }: { status: string }) {
  return (
    <span className={`job-status job-${status}`}>
      <span />
      {status}
    </span>
  );
}
