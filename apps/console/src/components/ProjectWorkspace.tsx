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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RegisteredProject } from "@foundry/contracts";
import {
  AlertTriangle,
  Box,
  Braces,
  CheckCircle2,
  FolderGit2,
  FolderKanban,
  FolderOpen,
  GitCommitHorizontal,
  LoaderCircle,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { listProjects, refreshProject, registerProject, selectProjectDirectory } from "../api.js";
import { formatRelativeTime, shortId } from "../model.js";

function FoundationStatus({
  status,
}: {
  readonly status: RegisteredProject["foundation"]["status"];
}) {
  const ready = status === "ready";
  return (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        ready
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
      )}
    >
      {ready ? <CheckCircle2 /> : <AlertTriangle />}
      {status}
    </Badge>
  );
}

function RegistrationDialog(props: {
  readonly open: boolean;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onClose: () => void;
  readonly onSubmit: (input: { rootDir: string; projectId?: string }) => void;
}) {
  const [rootDir, setRootDir] = useState("");
  const [projectId, setProjectId] = useState("");
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [pickerError, setPickerError] = useState<string>();

  useEffect(() => {
    if (props.open) {
      setRootDir("");
      setProjectId("");
      setPickerError(undefined);
    }
  }, [props.open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit({
      rootDir: rootDir.trim(),
      ...(projectId.trim() ? { projectId: projectId.trim() } : {}),
    });
  };

  const chooseDirectory = async () => {
    setPickingDirectory(true);
    setPickerError(undefined);
    try {
      const selection = await selectProjectDirectory();
      if (selection.path) setRootDir(selection.path);
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "Could not open the folder picker.");
    } finally {
      setPickingDirectory(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && !props.pending && props.onClose()}>
      <DialogContent>
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="text-xl">Register a Next.js project</DialogTitle>
            <DialogDescription>
              Foundry inspects the repository and freezes its Style Guide and Container profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="project-root-dir">
                Absolute project path
              </label>
              <div className="relative">
                <Input
                  id="project-root-dir"
                  autoFocus
                  required
                  className="pr-11"
                  value={rootDir}
                  placeholder="/Users/name/repos/next-project"
                  onChange={(event) => setRootDir(event.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  disabled={pickingDirectory || props.pending}
                  aria-label="Choose project folder"
                  title="Choose project folder"
                  onClick={chooseDirectory}
                >
                  {pickingDirectory ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="project-id">
                Project ID <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="project-id"
                value={projectId}
                placeholder="Derived from the directory name"
                onChange={(event) => setProjectId(event.target.value)}
              />
            </div>
          </div>
          {(props.error || pickerError) && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>
                {pickerError ? "Folder picker unavailable" : "Registration failed"}
              </AlertTitle>
              <AlertDescription>{pickerError ?? props.error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button disabled={props.pending || !rootDir.trim()}>
              {props.pending ? "Inspecting…" : "Inspect and register"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailMetric(props: {
  readonly label: string;
  readonly value: string;
  readonly icon: typeof Package;
}) {
  const Icon = props.icon;
  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardDescription className="text-xs">{props.label}</CardDescription>
          <CardTitle
            className="mt-1 truncate text-base font-semibold capitalize"
            title={props.value}
          >
            {props.value}
          </CardTitle>
        </div>
        <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      </CardHeader>
    </Card>
  );
}

function ProjectDetail(props: {
  readonly project: RegisteredProject;
  readonly refreshing: boolean;
  readonly error: string | undefined;
  readonly onRefresh: (acceptChanges: boolean) => void;
}) {
  const { project } = props;
  const foundation = project.foundation;
  const styleGuide = foundation.styleGuide;
  const container = foundation.container;

  return (
    <main className="min-w-0 p-4 sm:p-6 xl:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FoundationStatus status={foundation.status} />
              <Badge variant="outline" className="font-normal">
                Next.js · {project.profile.framework.router} router
              </Badge>
            </div>
            <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {project.projectId}
            </h1>
            <p
              className="mt-2 truncate font-mono text-xs text-muted-foreground"
              title={project.rootDir}
            >
              {project.rootDir}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {foundation.status === "stale" && (
              <Button
                variant="outline"
                disabled={props.refreshing}
                onClick={() => props.onRefresh(true)}
              >
                Accept foundation changes
              </Button>
            )}
            <Button disabled={props.refreshing} onClick={() => props.onRefresh(false)}>
              <RefreshCw
                className={cn(props.refreshing && "animate-spin")}
                data-icon="inline-start"
              />
              {props.refreshing ? "Inspecting…" : "Refresh readiness"}
            </Button>
          </div>
        </header>

        {props.error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Refresh failed</AlertTitle>
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        )}
        {foundation.reasons.length > 0 && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Readiness diagnostics</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {foundation.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Project summary">
          <DetailMetric label="Foundation" value={foundation.status} icon={CheckCircle2} />
          <DetailMetric
            label="Inspected commit"
            value={shortId(project.profile.inspectedCommit, 12)}
            icon={GitCommitHorizontal}
          />
          <DetailMetric
            label="Package manager"
            value={project.profile.packageManager}
            icon={Package}
          />
          <DetailMetric
            label="Updated"
            value={formatRelativeTime(project.updatedAt)}
            icon={RefreshCw}
          />
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="size-4 text-primary" />
                Style Guide
              </CardTitle>
              <CardDescription>
                Design tokens and primitives protected from component agents.
              </CardDescription>
              <CardAction>
                <Badge variant="secondary" className="capitalize">
                  {styleGuide?.source ?? "missing"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {styleGuide ? (
                <>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[
                      ["Color tokens", styleGuide.colors.length],
                      ["Spacing tokens", styleGuide.spacing.length],
                      ["Typography", styleGuide.typography.length],
                      ["Breakpoints", Object.keys(styleGuide.breakpoints).length],
                      ["Primitives", styleGuide.primitives.length],
                    ].map(([label, value]) => (
                      <div className="rounded-lg border bg-muted/30 p-3" key={label}>
                        <dt className="text-[11px] text-muted-foreground">{label}</dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Protected files</p>
                    {styleGuide.files.map((file) => (
                      <code
                        className="block truncate rounded-md bg-muted px-2.5 py-2 text-xs"
                        key={file}
                      >
                        {file}
                      </code>
                    ))}
                  </div>
                </>
              ) : (
                <div className="grid min-h-48 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No valid Style Guide detected.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Box className="size-4 text-primary" />
                Container
              </CardTitle>
              <CardDescription>
                Responsive layout boundary shared by generated sections.
              </CardDescription>
              <CardAction>
                <Badge variant="secondary" className="capitalize">
                  {container?.source ?? "missing"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {container ? (
                <>
                  <dl className="grid grid-cols-2 gap-2">
                    {[
                      ["Desktop width", container.desktopMaxWidth],
                      ["Mobile width", container.mobileMaxWidth],
                      ["Full bleed", container.supportsFullBleed ? "Yes" : "No"],
                      ["Breakpoints", Object.keys(container.paddingByBreakpoint).length],
                    ].map(([label, value]) => (
                      <div className="rounded-lg border bg-muted/30 p-3" key={label}>
                        <dt className="text-[11px] text-muted-foreground">{label}</dt>
                        <dd className="mt-1 text-base font-semibold">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Protected component</p>
                    <code className="block truncate rounded-md bg-muted px-2.5 py-2 text-xs">
                      {container.componentPath}
                    </code>
                    <p className="pt-1 text-xs font-medium text-muted-foreground">Import</p>
                    <code className="block truncate rounded-md bg-muted px-2.5 py-2 text-xs">
                      {container.importPath}
                    </code>
                  </div>
                </>
              ) : (
                <div className="grid min-h-48 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No valid Container detected.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Braces className="size-4 text-primary" />
                Project profile
              </CardTitle>
              <CardDescription>
                Detected conventions supplied to every component worker.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-x-8 gap-y-0 md:grid-cols-2">
              {[
                ["App directory", project.profile.framework.appDir],
                ["Section root", project.profile.paths.sectionRoot],
                ["Registry", project.profile.paths.registry ?? "Not detected"],
                ["Page query", project.profile.paths.pageQuery ?? "Not detected"],
                ["CMS", project.profile.cms ?? "Not detected"],
                [
                  "Foundation fingerprint",
                  foundation.status === "ready"
                    ? shortId(foundation.fingerprint, 30)
                    : "Not frozen",
                ],
              ].map(([label, value]) => (
                <div
                  className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-3 border-b py-3 last:border-b-0 md:nth-last-2:border-b-0"
                  key={label}
                >
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <code className="truncate text-xs">{value}</code>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

export function ProjectWorkspace() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  useEffect(() => {
    if (!selectedId && projects.data?.[0]) setSelectedId(projects.data[0].projectId);
  }, [projects.data, selectedId]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (projects.data ?? []).filter(
      (project) =>
        !needle ||
        project.projectId.toLowerCase().includes(needle) ||
        project.rootDir.toLowerCase().includes(needle),
    );
  }, [projects.data, search]);
  const selected = projects.data?.find(({ projectId }) => projectId === selectedId);

  const register = useMutation({
    mutationFn: registerProject,
    onSuccess: (project) => {
      setSelectedId(project.projectId);
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const refresh = useMutation({
    mutationFn: (acceptChanges: boolean) => refreshProject(selectedId!, acceptChanges),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <>
      <div className="grid min-h-[calc(100svh-4rem)] lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b bg-sidebar lg:h-[calc(100svh-4rem)] lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between px-4 pt-5 pb-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Registered</p>
              <h2 className="mt-0.5 font-heading text-lg font-semibold">Projects</h2>
            </div>
            <Button
              size="icon-sm"
              onClick={() => {
                register.reset();
                setDialogOpen(true);
              }}
              aria-label="Register project"
            >
              <Plus />
            </Button>
          </div>
          <div className="border-b px-4 pb-4">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
              />
            </div>
          </div>
          <ScrollArea className="max-h-64 flex-1 lg:max-h-none">
            <div className="space-y-1.5 p-3">
              {projects.isLoading ? (
                Array.from({ length: 2 }).map((_, index) => (
                  <div className="h-20 animate-pulse rounded-lg bg-muted" key={index} />
                ))
              ) : filtered.length === 0 ? (
                <div className="grid min-h-44 place-items-center rounded-lg border border-dashed p-6 text-center">
                  <div>
                    <FolderKanban className="mx-auto size-6 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">No projects registered</p>
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-1"
                      onClick={() => setDialogOpen(true)}
                    >
                      Add the first project
                    </Button>
                  </div>
                </div>
              ) : (
                filtered.map((project) => (
                  <button
                    className={cn(
                      "w-full rounded-lg border border-transparent p-3 text-left transition-colors hover:bg-sidebar-accent",
                      project.projectId === selectedId &&
                        "border-sidebar-border bg-background shadow-xs",
                    )}
                    key={project.projectId}
                    onClick={() => setSelectedId(project.projectId)}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <FolderGit2 className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm font-medium">
                          {project.projectId}
                        </strong>
                        <small className="mt-1 block text-xs text-muted-foreground">
                          {project.profile.framework.router} router ·{" "}
                          {project.profile.packageManager}
                        </small>
                      </span>
                    </div>
                    <div className="mt-3 pl-12">
                      <FoundationStatus status={project.foundation.status} />
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </aside>

        {selected ? (
          <ProjectDetail
            project={selected}
            refreshing={refresh.isPending}
            error={refresh.error?.message}
            onRefresh={(accept) => refresh.mutate(accept)}
          />
        ) : (
          <main className="grid min-h-[65svh] place-items-center p-6">
            <Card className="w-full max-w-xl text-center">
              <CardHeader className="items-center">
                <span className="mb-3 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                  <FolderKanban className="size-6" />
                </span>
                <CardTitle className="text-2xl">Register your first project</CardTitle>
                <CardDescription className="max-w-md">
                  Inspect its conventions, freeze the Style Guide and Container, then make it
                  available to every component worker.
                </CardDescription>
              </CardHeader>
              <CardContent className="items-center">
                <Button onClick={() => setDialogOpen(true)}>Register project</Button>
              </CardContent>
            </Card>
          </main>
        )}
      </div>

      <RegistrationDialog
        open={dialogOpen}
        pending={register.isPending}
        error={register.error?.message}
        onClose={() => setDialogOpen(false)}
        onSubmit={(input) => register.mutate(input)}
      />
    </>
  );
}
