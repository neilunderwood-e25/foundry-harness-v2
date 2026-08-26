import type { DurableRun, DurableRunSnapshot, RunCancellation, RunEvent } from "@foundry/contracts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = (await response.json()) as T | { error?: string; message?: string };
  if (!response.ok) {
    const error = payload as { error?: string; message?: string };
    throw new Error(error.message ?? error.error ?? `Request failed with HTTP ${response.status}`);
  }
  return payload as T;
}

export function listRuns(projectId?: string): Promise<DurableRun[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (projectId) params.set("projectId", projectId);
  return request(`/api/runs?${params}`);
}

export function getRun(runId: string): Promise<DurableRunSnapshot> {
  return request(`/api/runs/${encodeURIComponent(runId)}`);
}

export function startDelivery(delivery: unknown): Promise<{ run: DurableRun }> {
  return request("/api/runs/deliver/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(delivery),
  });
}

export function cancelRun(runId: string): Promise<RunCancellation> {
  return request(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

export function artifactUrl(runId: string, artifactId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

export function subscribeToRun(
  runId: string,
  onEvent: (event: RunEvent) => void,
  onConnection: (connected: boolean) => void,
): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events/stream`);
  source.onopen = () => onConnection(true);
  source.onerror = () => onConnection(false);
  source.onmessage = (event) => onEvent(JSON.parse(event.data) as RunEvent);
  const eventTypes = [
    "run.started",
    "run.interrupted",
    "run.cancelled",
    "run.completed",
    "job.queued",
    "job.started",
    "job.cancelled",
    "job.failed",
    "job.completed",
    "phase.started",
    "phase.completed",
    "agent.text",
    "agent.tool.started",
    "agent.tool.completed",
    "verification.completed",
    "artifact.created",
  ];
  for (const type of eventTypes) {
    source.addEventListener(type, (event) =>
      onEvent(JSON.parse((event as MessageEvent<string>).data) as RunEvent),
    );
  }
  return () => source.close();
}
