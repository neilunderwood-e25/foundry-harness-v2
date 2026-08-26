import type { DurableRunSnapshot, RunEvent } from "@foundry/contracts";
import { useMemo, useState } from "react";
import { artifactUrl } from "../api.js";
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
import { BranchIcon, CopyIcon, ExternalIcon, FileIcon, StopIcon } from "./Icons.js";
import { JobStatus, StatusBadge } from "./StatusBadge.js";

type DetailTab = "overview" | "events" | "evidence";

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

interface RunDetailProps {
  readonly snapshot: DurableRunSnapshot;
  readonly connected: boolean;
  readonly cancelling: boolean;
  readonly onCancel: () => void;
  readonly onDuplicate: () => void;
}

export function RunDetail(props: RunDetailProps) {
  const [tab, setTab] = useState<DetailTab>("overview");
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
    <main className="run-detail">
      <header className="run-header">
        <div className="run-heading">
          <div className="run-title-row">
            <StatusBadge status={snapshot.run.status} />
            {active && (
              <span className={`live-indicator${props.connected ? " connected" : ""}`}>
                <span /> {props.connected ? "Live" : "Reconnecting"}
              </span>
            )}
          </div>
          <h1 title={snapshot.run.runId}>{snapshot.run.runId}</h1>
          <p>
            <span>{snapshot.run.projectId}</span>
            <span>·</span>
            <span>{request?.batch.components.length ?? snapshot.jobs.length} components</span>
            <span>·</span>
            <span>updated {formatRelativeTime(snapshot.run.updatedAt)}</span>
          </p>
        </div>
        <div className="run-actions">
          <button className="text-button duplicate-button" onClick={props.onDuplicate}>
            <CopyIcon /> Duplicate
          </button>
          {active && (
            <button className="danger-button" onClick={props.onCancel} disabled={props.cancelling}>
              <StopIcon /> {props.cancelling ? "Cancelling…" : "Cancel run"}
            </button>
          )}
        </div>
      </header>

      {snapshot.run.errorMessage && (
        <div className="run-error-banner">
          <strong>{snapshot.run.errorCode ?? "Run failed"}</strong>
          <p>{snapshot.run.errorMessage}</p>
        </div>
      )}

      <section className="run-metrics" aria-label="Run summary">
        <div className="progress-metric">
          <div className="metric-topline">
            <span>Delivery progress</span>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>
            {snapshot.jobs.filter(({ status }) => status === "passed").length} of{" "}
            {snapshot.jobs.length || request?.batch.components.length || 0} components passed
          </small>
        </div>
        <div className="metric-block">
          <span>Elapsed</span>
          <strong>{formatDuration(snapshot.run.startedAt, snapshot.run.completedAt)}</strong>
        </div>
        <div className="metric-block">
          <span>Evidence</span>
          <strong>{snapshot.artifacts.length}</strong>
        </div>
        <div className="metric-block">
          <span>Attempts</span>
          <strong>{snapshot.verificationReports.length}</strong>
        </div>
      </section>

      <nav className="detail-tabs" aria-label="Run details">
        {(["overview", "events", "evidence"] as const).map((value) => (
          <button
            className={tab === value ? "active" : ""}
            key={value}
            onClick={() => setTab(value)}
          >
            {value}
            {value === "events" && <span>{snapshot.events.length}</span>}
            {value === "evidence" && <span>{snapshot.artifacts.length}</span>}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="overview-layout">
          <section className="panel component-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Parallel workers</span>
                <h2>Components</h2>
              </div>
              <span className="panel-count">
                {snapshot.jobs.length || request?.batch.components.length || 0}
              </span>
            </div>
            <div className="component-grid">
              {snapshot.jobs.length === 0
                ? request?.batch.components.map((component) => (
                    <article className="component-card" key={component.componentId}>
                      <div className="component-index">
                        {component.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="component-copy">
                        <h3>{component.name}</h3>
                        <p>{component.agent.provider} · awaiting preparation</p>
                      </div>
                      <JobStatus status="queued" />
                    </article>
                  ))
                : snapshot.jobs.map((job) => (
                    <article className={`component-card component-${job.status}`} key={job.jobId}>
                      <div className="component-index">
                        {componentName(snapshot, job).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="component-copy">
                        <h3>{componentName(snapshot, job)}</h3>
                        <p>
                          {componentProvider(snapshot, job) ?? "agent"} ·{" "}
                          {formatDuration(job.startedAt, job.completedAt)}
                        </p>
                        {job.errorMessage && <small>{job.errorMessage}</small>}
                      </div>
                      <JobStatus status={job.status} />
                    </article>
                  ))}
            </div>
          </section>

          <aside className="panel timeline-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Harness</span>
                <h2>Stage timeline</h2>
              </div>
            </div>
            <ol className="stage-list">
              {snapshot.steps.length === 0 ? (
                <li className="stage-empty">Stages will appear when the run starts.</li>
              ) : (
                snapshot.steps.map((step) => (
                  <li className={`stage-${step.status}`} key={step.stepId}>
                    <span className="stage-marker" />
                    <div>
                      <strong>{phaseLabel(step.phase)}</strong>
                      <small>{step.jobId ? shortId(step.jobId, 30) : "batch"}</small>
                    </div>
                    <time>{formatDuration(step.startedAt, step.completedAt)}</time>
                  </li>
                ))
              )}
            </ol>
          </aside>

          {failedGates.length > 0 && (
            <section className="panel gate-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Attention</span>
                  <h2>Failed gates</h2>
                </div>
                <span className="panel-count danger-count">{failedGates.length}</span>
              </div>
              <div className="gate-list">
                {failedGates.map((gate, index) => (
                  <article key={`${gate.id}-${index}`}>
                    <strong>{gate.label}</strong>
                    <span>{gate.category}</span>
                    <p>{gate.detail ?? "No detail provided"}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === "events" && (
        <section className="panel event-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Append-only log</span>
              <h2>Run activity</h2>
            </div>
            <span className="sequence-chip">latest #{sortedEvents[0]?.sequence ?? 0}</span>
          </div>
          <div className="event-list">
            {sortedEvents.map((event) => (
              <article
                className={`event-item event-${event.payload.type.split(".")[0]}`}
                key={event.eventId}
              >
                <span className="event-sequence">{String(event.sequence).padStart(3, "0")}</span>
                <div>
                  <strong>{event.payload.type}</strong>
                  <p>{eventLabel(event)}</p>
                </div>
                <time dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "evidence" && (
        <section className="panel evidence-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Retained outside worktrees</span>
              <h2>Artifacts & reports</h2>
            </div>
            <span className="panel-count">{snapshot.artifacts.length}</span>
          </div>
          {snapshot.artifacts.length === 0 ? (
            <div className="evidence-empty">
              <FileIcon />
              <p>No artifacts have been captured yet.</p>
            </div>
          ) : (
            <div className="artifact-grid">
              {snapshot.artifacts.map((artifact) => {
                const url = artifactUrl(snapshot.run.runId, artifact.artifactId);
                return (
                  <article className="artifact-card" key={artifact.artifactId}>
                    <a className="artifact-preview" href={url} target="_blank" rel="noreferrer">
                      {artifact.mediaType.startsWith("image/") ? (
                        <img src={url} alt="" loading="lazy" />
                      ) : (
                        <FileIcon />
                      )}
                    </a>
                    <div className="artifact-info">
                      <span>{artifact.kind}</span>
                      <strong title={artifact.artifactId}>
                        {shortId(artifact.artifactId, 34)}
                      </strong>
                      <p title={artifact.path}>{shortId(artifact.path, 48)}</p>
                    </div>
                    <a
                      className="artifact-open"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      title="Open artifact"
                    >
                      <ExternalIcon />
                    </a>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export function EmptyRunDetail({ onNew }: { onNew: () => void }) {
  return (
    <main className="run-detail empty-detail">
      <div className="empty-mark">
        <BranchIcon />
      </div>
      <span className="eyebrow">No run selected</span>
      <h1>
        Build sections in parallel,
        <br />
        without losing control.
      </h1>
      <p>
        Launch a delivery or select a previous run to inspect worktrees, verification gates, and
        retained evidence.
      </p>
      <button className="primary-button" onClick={onNew}>
        Start a delivery
      </button>
    </main>
  );
}
