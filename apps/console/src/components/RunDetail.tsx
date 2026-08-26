import type { DurableRunSnapshot, RunEvent } from "@foundry/contracts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Boxes,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Layers3,
  Radio,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useMemo } from "react";
import { artifactUrl, diagnosticsUrl } from "../api.js";
import {
  componentName,
  componentProvider,
  deliveryRequest,
  formatDuration,
  formatRelativeTime,
  isActiveStatus,
  runProgress,
  shortId,
} from "../model.js";
import { JobStatus, StatusBadge } from "./StatusBadge.js";

function eventLabel(event: RunEvent): string {
  const payload = event.payload;
  switch (payload.type) {
    case "run.started":
      return "Run started";
    case "run.interrupted":
      return `Run interrupted · ${payload.reason}`;
    case "run.cancelled":
      return `Run cancelled · ${payload.reason}`;
    case "run.completed":
      return `Run completed · ${payload.status}`;
    case "job.queued":
      return `${payload.componentId} queued`;
    case "job.started":
      return `${payload.componentId} started`;
    case "job.cancelled":
      return `${payload.componentId} cancelled`;
    case "job.failed":
      return `${payload.jobId} failed · ${payload.message}`;
    case "job.completed":
      return `${payload.componentId} completed`;
    case "phase.started":
      return `${payload.phase} started`;
    case "phase.completed":
      return `${payload.phase} completed`;
    case "agent.text":
      return payload.text;
    case "agent.tool.started":
      return `${payload.tool} started`;
    case "agent.tool.completed":
      return `${payload.tool} ${payload.ok ? "completed" : "failed"}`;
    case "verification.completed":
      return `Verification ${payload.verdict}`;
    case "artifact.created":
      return `Evidence captured · ${payload.artifactId}`;
  }
}

function phaseLabel(value: string): string {
  return value
    .replaceAll(":", " · ")
    .replaceAll("-", " ")
    .replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function MetricCard(props: {
  readonly label: string;
  readonly value: string | number;
  readonly detail?: string;
  readonly icon: typeof Clock3;
}) {
  const Icon = props.icon;
  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardDescription className="text-xs">{props.label}</CardDescription>
          <CardTitle className="mt-1 text-xl font-semibold tabular-nums">{props.value}</CardTitle>
        </div>
        <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      </CardHeader>
      {props.detail && (
        <CardContent className="text-xs text-muted-foreground">{props.detail}</CardContent>
      )}
    </Card>
  );
}

interface RunDetailProps {
  readonly snapshot: DurableRunSnapshot;
  readonly connected: boolean;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
  readonly onDuplicate: () => void;
}

export function RunDetail(props: RunDetailProps) {
  const snapshot = props.snapshot;
  const request = deliveryRequest(snapshot.run);
  const progress = runProgress(snapshot);
  const active = isActiveStatus(snapshot.run.status);
  const sortedEvents = useMemo(
    () => [...snapshot.events].sort((a, b) => b.sequence - a.sequence),
    [snapshot.events],
  );
  const failedGates = snapshot.verificationReports.flatMap((report) =>
    report.gates.filter(({ status }) => status === "failed"),
  );

  return (
    <main className="min-w-0 p-4 sm:p-6 xl:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={snapshot.run.status} />
              {active && (
                <Badge variant="outline" className="gap-1.5 font-normal">
                  <Radio className={cn("size-3", props.connected && "text-emerald-600")} />
                  {props.connected ? "Live" : "Reconnecting"}
                </Badge>
              )}
            </div>
            <h1
              className="mt-3 truncate font-mono text-2xl font-semibold tracking-tight sm:text-3xl"
              title={snapshot.run.runId}
            >
              {snapshot.run.runId}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>{snapshot.run.projectId}</span>
              <span>•</span>
              <span>{request?.batch.components.length ?? snapshot.jobs.length} components</span>
              <span>•</span>
              <span>Updated {formatRelativeTime(snapshot.run.updatedAt)}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => window.location.assign(diagnosticsUrl(snapshot.run.runId))}
            >
              <Download data-icon="inline-start" /> Diagnostics
            </Button>
            <Button variant="outline" onClick={props.onDuplicate}>
              <Copy data-icon="inline-start" /> Duplicate
            </Button>
            {active && (
              <Button variant="destructive" onClick={props.onCancel} disabled={props.cancelling}>
                <Square data-icon="inline-start" />
                {props.cancelling ? "Cancelling…" : "Cancel run"}
              </Button>
            )}
          </div>
        </header>

        {snapshot.run.errorMessage && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{snapshot.run.errorCode ?? "Run failed"}</AlertTitle>
            <AlertDescription>{snapshot.run.errorMessage}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              <span>Delivery progress</span>
              <span className="tabular-nums">{progress}%</span>
            </CardTitle>
            <CardDescription>
              {snapshot.jobs.filter(({ status }) => status === "passed").length} of{" "}
              {snapshot.jobs.length || request?.batch.components.length || 0} components passed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress} aria-label={`${progress}% complete`} />
          </CardContent>
        </Card>

        <section className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Elapsed"
            value={formatDuration(snapshot.run.startedAt, snapshot.run.completedAt)}
            icon={Clock3}
          />
          <MetricCard
            label="Evidence"
            value={snapshot.artifacts.length}
            detail="Retained artifacts"
            icon={FileText}
          />
          <MetricCard
            label="Verification"
            value={snapshot.verificationReports.length}
            detail="Recorded attempts"
            icon={ShieldCheck}
          />
        </section>

        <Tabs defaultValue="overview" className="gap-4">
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="events">
              Events{" "}
              <Badge variant="secondary" className="ml-1">
                {snapshot.events.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="evidence">
              Evidence{" "}
              <Badge variant="secondary" className="ml-1">
                {snapshot.artifacts.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,.8fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Boxes className="size-4 text-muted-foreground" />
                    Components
                  </CardTitle>
                  <CardDescription>Parallel agent workers for this delivery.</CardDescription>
                  <CardAction>
                    <Badge variant="secondary">
                      {snapshot.jobs.length || request?.batch.components.length || 0}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="gap-2">
                  {snapshot.jobs.length === 0
                    ? request?.batch.components.map((component) => (
                        <div
                          className="flex items-center gap-3 rounded-lg border p-3"
                          key={component.componentId}
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold">
                            {component.name.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-sm font-medium">{component.name}</h3>
                            <p className="text-xs text-muted-foreground">
                              {component.agent.provider} · awaiting preparation
                            </p>
                          </div>
                          <JobStatus status="queued" />
                        </div>
                      ))
                    : snapshot.jobs.map((job) => (
                        <div
                          className="flex items-center gap-3 rounded-lg border p-3"
                          key={job.jobId}
                        >
                          <span
                            className={cn(
                              "grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold",
                              job.status === "running" && "bg-blue-50 text-blue-700",
                              job.status === "passed" && "bg-emerald-50 text-emerald-700",
                              job.status === "failed" && "bg-red-50 text-red-700",
                            )}
                          >
                            {componentName(snapshot, job).slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-sm font-medium">
                              {componentName(snapshot, job)}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              {componentProvider(snapshot, job) ?? "agent"} ·{" "}
                              {formatDuration(job.startedAt, job.completedAt)}
                            </p>
                            {job.errorMessage && (
                              <p className="mt-1 truncate text-xs text-destructive">
                                {job.errorMessage}
                              </p>
                            )}
                          </div>
                          <JobStatus status={job.status} />
                        </div>
                      ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers3 className="size-4 text-muted-foreground" />
                    Stage timeline
                  </CardTitle>
                  <CardDescription>Harness-owned workflow stages.</CardDescription>
                </CardHeader>
                <CardContent>
                  {snapshot.steps.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                      Stages will appear when the run starts.
                    </p>
                  ) : (
                    <ol className="space-y-0">
                      {snapshot.steps.map((step, index) => (
                        <li
                          className="relative grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 pb-5 last:pb-0"
                          key={step.stepId}
                        >
                          {index < snapshot.steps.length - 1 && (
                            <span className="absolute top-3 bottom-0 left-[5px] w-px bg-border" />
                          )}
                          <span
                            className={cn(
                              "relative z-10 mt-1 size-2.5 rounded-full border-2 border-background bg-muted-foreground ring-1 ring-border",
                              step.status === "completed" && "bg-emerald-500",
                              step.status === "running" && "animate-pulse bg-blue-500",
                              step.status === "interrupted" && "bg-red-500",
                            )}
                          />
                          <div className="min-w-0">
                            <strong className="block truncate text-xs font-medium">
                              {phaseLabel(step.phase)}
                            </strong>
                            <small className="font-mono text-[10px] text-muted-foreground">
                              {step.jobId ? shortId(step.jobId, 28) : "batch"}
                            </small>
                          </div>
                          <time className="text-[10px] text-muted-foreground">
                            {formatDuration(step.startedAt, step.completedAt)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </div>

            {failedGates.length > 0 && (
              <Card className="ring-destructive/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="size-4" />
                    Failed gates
                  </CardTitle>
                  <CardDescription>Verification issues that require attention.</CardDescription>
                  <CardAction>
                    <Badge variant="destructive">{failedGates.length}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {failedGates.map((gate, index) => (
                    <Alert variant="destructive" key={`${gate.id}-${index}`}>
                      <AlertCircle />
                      <AlertTitle>{gate.label}</AlertTitle>
                      <AlertDescription>{gate.detail ?? "No detail provided"}</AlertDescription>
                    </Alert>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle>Run activity</CardTitle>
                <CardDescription>Append-only event journal, newest first.</CardDescription>
                <CardAction>
                  <Badge variant="outline">latest #{sortedEvents[0]?.sequence ?? 0}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[34rem]">
                  <div className="divide-y rounded-lg border">
                    {sortedEvents.map((event) => (
                      <article
                        className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-3 p-3"
                        key={event.eventId}
                      >
                        <span className="font-mono text-[10px] text-muted-foreground">
                          #{String(event.sequence).padStart(3, "0")}
                        </span>
                        <div className="min-w-0">
                          <strong className="block font-mono text-xs font-medium">
                            {event.payload.type}
                          </strong>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {eventLabel(event)}
                          </p>
                        </div>
                        <time
                          className="hidden text-[10px] text-muted-foreground sm:block"
                          dateTime={event.occurredAt}
                        >
                          {new Date(event.occurredAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </time>
                      </article>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="evidence">
            <Card>
              <CardHeader>
                <CardTitle>Artifacts & reports</CardTitle>
                <CardDescription>Evidence retained outside component worktrees.</CardDescription>
                <CardAction>
                  <Badge variant="secondary">{snapshot.artifacts.length}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                {snapshot.artifacts.length === 0 ? (
                  <div className="grid min-h-56 place-items-center rounded-lg border border-dashed text-center text-muted-foreground">
                    <div>
                      <FileText className="mx-auto size-7" />
                      <p className="mt-2 text-sm">No artifacts captured yet.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {snapshot.artifacts.map((artifact) => {
                      const url = artifactUrl(snapshot.run.runId, artifact.artifactId);
                      return (
                        <a
                          className="group overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          key={artifact.artifactId}
                        >
                          <div className="grid aspect-[16/7] place-items-center overflow-hidden bg-muted text-muted-foreground">
                            {artifact.mediaType.startsWith("image/") ? (
                              <img
                                className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                                src={url}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <ImageIcon className="size-7" />
                            )}
                          </div>
                          <div className="flex items-start gap-3 p-3">
                            <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <Badge variant="secondary" className="mb-2">
                                {artifact.kind}
                              </Badge>
                              <strong className="block truncate font-mono text-xs">
                                {shortId(artifact.artifactId, 34)}
                              </strong>
                              <p
                                className="mt-1 truncate text-[11px] text-muted-foreground"
                                title={artifact.path}
                              >
                                {artifact.path}
                              </p>
                            </div>
                            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

export function EmptyRunDetail({ onNew }: { onNew: () => void }) {
  return (
    <main className="grid min-h-[65svh] place-items-center p-6">
      <Card className="w-full max-w-xl text-center">
        <CardHeader className="items-center">
          <span className="mb-3 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <GitBranch className="size-6" />
          </span>
          <CardTitle className="text-2xl">Build sections in parallel</CardTitle>
          <CardDescription className="max-w-md">
            Launch a delivery or select a previous run to inspect worktrees, verification gates, and
            retained evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="items-center">
          <Button onClick={onNew}>Start a delivery</Button>
        </CardContent>
      </Card>
    </main>
  );
}
