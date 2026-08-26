import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { cancelRun, getRun, listRuns, startDelivery, subscribeToRun } from "./api.js";
import { EmptyRunDetail, RunDetail } from "./components/RunDetail.js";
import { MarkIcon, PlusIcon } from "./components/Icons.js";
import { NewRunDialog } from "./components/NewRunDialog.js";
import { RunSidebar } from "./components/RunSidebar.js";
import { deliveryRequest, isActiveStatus } from "./model.js";

export function App() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDocument, setDialogDocument] = useState<unknown>();
  const [connected, setConnected] = useState(false);

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

  return (
    <div className="console-shell">
      <header className="global-header">
        <a className="brand" href="/console/" aria-label="Foundry Console">
          <span className="brand-mark">
            <MarkIcon />
          </span>
          <span>
            <strong>Foundry</strong>
            <small>Operator console</small>
          </span>
        </a>
        <div className="global-summary">
          <span className={`service-status${health.isSuccess ? " online" : ""}`}>
            <i /> {health.isSuccess ? "Harness online" : "Harness offline"}
          </span>
          <span>
            {runs.data?.filter(({ status }) => isActiveStatus(status)).length ?? 0} active
          </span>
          <span>{runs.data?.filter(({ status }) => status === "passed").length ?? 0} passed</span>
          <button className="primary-button header-new-button" onClick={() => openNew()}>
            <PlusIcon /> New run
          </button>
        </div>
      </header>

      <div className="console-workspace">
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
          <main className="run-detail empty-detail">
            <span className="eyebrow">Unable to load run</span>
            <h1>Run details unavailable.</h1>
            <p>{snapshot.error.message}</p>
            <button className="text-button" onClick={() => snapshot.refetch()}>
              Try again
            </button>
          </main>
        ) : selectedRunId ? (
          <main className="run-detail detail-loading">
            <div className="loading-line" />
            <div className="loading-card" />
            <div className="loading-card" />
          </main>
        ) : (
          <EmptyRunDetail onNew={() => openNew()} />
        )}
      </div>

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
