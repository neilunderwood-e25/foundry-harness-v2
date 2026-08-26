import type { DurableRun } from "@foundry/contracts";
import { ChevronIcon, PlusIcon, SearchIcon } from "./Icons.js";
import { StatusBadge } from "./StatusBadge.js";
import { formatRelativeTime, shortId } from "../model.js";

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
    <aside className="run-sidebar">
      <div className="sidebar-topline">
        <div>
          <span className="eyebrow">Workspace</span>
          <h2>Delivery runs</h2>
        </div>
        <button className="icon-button accent-button" onClick={props.onNew} title="Start a run">
          <PlusIcon />
          <span className="sr-only">Start a run</span>
        </button>
      </div>

      <label className="search-field">
        <SearchIcon />
        <input
          value={props.search}
          onChange={(event) => props.onSearch(event.target.value)}
          placeholder="Search runs"
          aria-label="Search runs"
        />
      </label>

      <label className="project-filter">
        <span>Project</span>
        <select value={props.projectId} onChange={(event) => props.onProject(event.target.value)}>
          <option value="">All projects</option>
          {props.projects.map((project) => (
            <option value={project} key={project}>
              {project}
            </option>
          ))}
        </select>
      </label>

      <div className="run-list" aria-live="polite">
        {props.loading ? (
          <div className="run-list-skeleton" aria-label="Loading runs">
            <span />
            <span />
            <span />
          </div>
        ) : props.runs.length === 0 ? (
          <div className="sidebar-empty">
            <p>No matching runs.</p>
            <button onClick={props.onNew}>Start the first one</button>
          </div>
        ) : (
          props.runs.map((run) => (
            <button
              className={`run-list-item${props.selectedRunId === run.runId ? " selected" : ""}`}
              key={run.runId}
              onClick={() => props.onSelect(run.runId)}
            >
              <div className="run-list-item-top">
                <strong title={run.runId}>{shortId(run.runId, 24)}</strong>
                <ChevronIcon />
              </div>
              <span className="run-project">{run.projectId}</span>
              <div className="run-list-item-bottom">
                <StatusBadge status={run.status} compact />
                <time dateTime={run.updatedAt}>{formatRelativeTime(run.updatedAt)}</time>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
