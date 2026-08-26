import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Boxes, FolderKanban, Gauge, Plus, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cancelRun, getRun, listRuns, startDelivery, subscribeToRun } from "./api.js";
import { EmptyRunDetail, RunDetail } from "./components/RunDetail.js";
import { NewRunDialog } from "./components/NewRunDialog.js";
import { EvaluationWorkspace } from "./components/EvaluationWorkspace.js";
import { ProjectWorkspace } from "./components/ProjectWorkspace.js";
import { RunSidebar } from "./components/RunSidebar.js";
import { deliveryRequest, isActiveStatus } from "./model.js";

type ConsoleView = "runs" | "projects" | "insights";

export function App() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDocument, setDialogDocument] = useState<unknown>();
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<ConsoleView>("runs");

  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/health");
      if (!response.ok) throw new Error("Harness is unavailable");
      return response.json() as Promise<{ status: string }>;
    },
    refetchInterval: 15_000,
  });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => listRuns(),
    refetchInterval: 8_000,
  });
  const snapshot = useQuery({
    queryKey: ["run", selectedRunId],
    queryFn: () => getRun(selectedRunId!),
    enabled: Boolean(selectedRunId),
    refetchInterval: (query) =>
      query.state.data && isActiveStatus(query.state.data.run.status) ? 5_000 : false,
  });

  useEffect(() => {
    if (!selectedRunId && runs.data?.[0]) setSelectedRunId(runs.data[0].runId);
  }, [runs.data, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || !snapshot.data || !isActiveStatus(snapshot.data.run.status)) {
      setConnected(false);
      return;
    }
    return subscribeToRun(
      selectedRunId,
      () => {
        void queryClient.invalidateQueries({ queryKey: ["run", selectedRunId] });
        void queryClient.invalidateQueries({ queryKey: ["runs"] });
      },
      setConnected,
    );
  }, [queryClient, selectedRunId, snapshot.data?.run.status]);

  const filteredRuns = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (runs.data ?? []).filter(
      (run) =>
        (!projectId || run.projectId === projectId) &&
        (!needle ||
          run.runId.toLowerCase().includes(needle) ||
          run.projectId.toLowerCase().includes(needle)),
    );
  }, [projectId, runs.data, search]);
  const projects = useMemo(
    () => [...new Set((runs.data ?? []).map(({ projectId: value }) => value))].sort(),
    [runs.data],
  );

  const start = useMutation({
    mutationFn: startDelivery,
    onSuccess: ({ run }) => {
      setDialogOpen(false);
      setSelectedRunId(run.runId);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["run", run.runId] });
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelRun(selectedRunId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["run", selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  const openNew = (document?: unknown) => {
    setDialogDocument(document);
    start.reset();
    setDialogOpen(true);
  };

  const activeCount = runs.data?.filter(({ status }) => isActiveStatus(status)).length ?? 0;

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="sticky top-0 z-40 flex h-16 items-center border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
        <a className="flex items-center gap-2.5" href="/console/" aria-label="Foundry Console">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Boxes className="size-5" />
          </span>
          <span className="hidden sm:block">
            <strong className="block text-sm font-semibold leading-none">Foundry</strong>
            <small className="mt-1 block text-[11px] text-muted-foreground">Agent harness</small>
          </span>
        </a>

        <nav
          className="absolute left-1/2 flex -translate-x-1/2 items-center rounded-lg bg-muted p-1"
          aria-label="Console sections"
        >
          {(
            [
              ["runs", "Runs", Activity],
              ["projects", "Projects", FolderKanban],
              ["insights", "Insights", Gauge],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium text-muted-foreground transition-all hover:text-foreground",
                view === value && "bg-background text-foreground shadow-xs",
              )}
              key={value}
              onClick={() => setView(value)}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            {health.isSuccess ? (
              <Wifi className="size-3.5 text-emerald-600" />
            ) : (
              <WifiOff className="size-3.5 text-destructive" />
            )}
            <span>{health.isSuccess ? "Harness online" : "Harness offline"}</span>
            <span className="text-border">•</span>
            <span>{activeCount} active</span>
          </div>
          {view === "runs" && (
            <Button size="sm" onClick={() => openNew()}>
              <Plus data-icon="inline-start" />
              <span className="hidden sm:inline">New run</span>
            </Button>
          )}
        </div>
      </header>

      {view === "projects" ? (
        <ProjectWorkspace />
      ) : view === "insights" ? (
        <EvaluationWorkspace />
      ) : (
        <div className="grid min-h-[calc(100svh-4rem)] lg:grid-cols-[19rem_minmax(0,1fr)]">
          <RunSidebar
            runs={filteredRuns}
            selectedRunId={selectedRunId}
            search={search}
            projectId={projectId}
            projects={projects}
            loading={runs.isLoading}
            onSearch={setSearch}
            onProject={setProjectId}
            onSelect={setSelectedRunId}
            onNew={() => openNew()}
          />
          {snapshot.data ? (
            <RunDetail
              snapshot={snapshot.data}
              connected={connected}
              cancelling={cancel.isPending}
              onCancel={() => cancel.mutate()}
              onDuplicate={() => openNew(deliveryRequest(snapshot.data.run))}
            />
          ) : snapshot.isError ? (
            <main className="grid min-h-[60svh] place-items-center p-6 text-center">
              <div>
                <h1 className="text-xl font-semibold">Run details unavailable</h1>
                <p className="mt-2 text-sm text-muted-foreground">{snapshot.error.message}</p>
                <Button variant="outline" className="mt-4" onClick={() => snapshot.refetch()}>
                  Try again
                </Button>
              </div>
            </main>
          ) : selectedRunId ? (
            <main className="space-y-4 p-6">
              <div className="h-12 w-1/2 animate-pulse rounded-lg bg-muted" />
              <div className="h-28 animate-pulse rounded-xl bg-muted" />
              <div className="h-72 animate-pulse rounded-xl bg-muted" />
            </main>
          ) : (
            <EmptyRunDetail onNew={() => openNew()} />
          )}
        </div>
      )}

      <NewRunDialog
        open={dialogOpen}
        initialDocument={dialogDocument}
        pending={start.isPending}
        error={start.error?.message}
        onClose={() => setDialogOpen(false)}
        onSubmit={(document) => start.mutate(document)}
      />
    </div>
  );
}
