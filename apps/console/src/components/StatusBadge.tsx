import type { DurableRunStatus } from "@foundry/contracts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

const statusTone: Record<DurableRunStatus, string> = {
  queued: "border-border bg-muted text-muted-foreground",
  running:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  cancelling:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  completed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  passed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  failed:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  partial:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  cancelled:
    "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
  interrupted:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

function StatusDot({ status }: { readonly status: string }) {
  const active = status === "running" || status === "cancelling";
  return (
    <span
      className={cn("size-1.5 rounded-full bg-current", active && "animate-pulse")}
      aria-hidden="true"
    />
  );
}

export function StatusBadge({
  status,
  compact = false,
}: {
  status: DurableRunStatus;
  compact?: boolean;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize", statusTone[status], compact && "h-4 px-1.5 text-[10px]")}
    >
      <StatusDot status={status} />
      {labels[status]}
    </Badge>
  );
}

export function JobStatus({ status }: { status: string }) {
  const tone =
    status === "passed" || status === "completed"
      ? "text-emerald-600"
      : status === "failed"
        ? "text-red-600"
        : status === "running"
          ? "text-blue-600"
          : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium capitalize", tone)}>
      <StatusDot status={status} />
      {status}
    </span>
  );
}
