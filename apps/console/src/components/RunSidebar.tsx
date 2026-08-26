import type { DurableRun } from "@foundry/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronRight, Plus, Search } from "lucide-react";
import { formatRelativeTime, shortId } from "../model.js";
import { StatusBadge } from "./StatusBadge.js";

interface RunSidebarProps {
  readonly runs: readonly DurableRun[];
  readonly selectedRunId: string | undefined;
  readonly search: string;
  readonly projectId: string;
  readonly projects: readonly string[];
  readonly loading: boolean;
  readonly onSearch: (value: string) => void;
  readonly onProject: (value: string) => void;
  readonly onSelect: (runId: string) => void;
  readonly onNew: () => void;
}

export function RunSidebar(props: RunSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col border-b bg-sidebar lg:h-[calc(100svh-4rem)] lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between px-4 pt-5 pb-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Workspace</p>
          <h2 className="mt-0.5 font-heading text-lg font-semibold">Delivery runs</h2>
        </div>
        <Button size="icon-sm" onClick={props.onNew} aria-label="Start a run">
          <Plus />
        </Button>
      </div>

      <div className="space-y-3 border-b px-4 pb-4">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
            placeholder="Search runs"
            aria-label="Search runs"
          />
        </div>
        <Select
          value={props.projectId || "all"}
          onValueChange={(value) => props.onProject(value === "all" ? "" : (value ?? ""))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {props.projects.map((project) => (
              <SelectItem value={project} key={project}>
                {project}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="max-h-64 flex-1 lg:max-h-none">
        <div className="space-y-1.5 p-3" aria-live="polite">
          {props.loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div className="h-24 animate-pulse rounded-lg bg-muted" key={index} />
            ))
          ) : props.runs.length === 0 ? (
            <div className="grid min-h-44 place-items-center rounded-lg border border-dashed p-6 text-center">
              <div>
                <p className="text-sm font-medium">No matching runs</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Start a delivery to see it here.
                </p>
                <Button variant="link" size="sm" className="mt-2" onClick={props.onNew}>
                  Start the first run
                </Button>
              </div>
            </div>
          ) : (
            props.runs.map((run) => (
              <button
                className={cn(
                  "group w-full rounded-lg border border-transparent p-3 text-left transition-colors hover:bg-sidebar-accent",
                  props.selectedRunId === run.runId &&
                    "border-sidebar-border bg-background shadow-xs",
                )}
                key={run.runId}
                onClick={() => props.onSelect(run.runId)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong
                      className="block truncate font-mono text-xs font-medium"
                      title={run.runId}
                    >
                      {shortId(run.runId, 26)}
                    </strong>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {run.projectId}
                    </span>
                  </div>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <StatusBadge status={run.status} compact />
                  <time className="text-[11px] text-muted-foreground" dateTime={run.updatedAt}>
                    {formatRelativeTime(run.updatedAt)}
                  </time>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
