import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  GitMerge,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { getEvaluationReport } from "../api.js";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function duration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(1)}s`;
}

function MetricCard(props: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly icon: typeof Gauge;
}) {
  const Icon = props.icon;
  return (
    <Card size="sm">
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardDescription>{props.label}</CardDescription>
          <CardTitle className="mt-1 text-2xl tabular-nums">{props.value}</CardTitle>
        </div>
        <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{props.detail}</CardContent>
    </Card>
  );
}

export function EvaluationWorkspace() {
  const report = useQuery({
    queryKey: ["evaluation"],
    queryFn: getEvaluationReport,
    refetchInterval: 15_000,
  });

  if (report.isLoading) {
    return (
      <main className="grid min-h-[calc(100svh-4rem)] gap-4 p-6 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="h-36 animate-pulse rounded-xl bg-muted" key={index} />
        ))}
      </main>
    );
  }

  if (report.isError || !report.data) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Evaluation unavailable</AlertTitle>
          <AlertDescription>
            {report.error?.message ?? "No evaluation report returned."}
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const { metrics } = report.data;
  return (
    <main className="min-w-0 p-4 sm:p-6 xl:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant={report.data.verdict === "passed" ? "default" : "destructive"}>
                {report.data.verdict === "passed" ? <CheckCircle2 /> : <AlertTriangle />}
                {report.data.verdict}
              </Badge>
              <span className="text-xs text-muted-foreground">{metrics.runs} runs evaluated</span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Quality insights
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Regression gates across generation, repair, visual parity, accessibility, and
              integration.
            </p>
          </div>
        </header>

        {metrics.runs === 0 && (
          <Alert>
            <Sparkles />
            <AlertTitle>No completed evaluation sample yet</AlertTitle>
            <AlertDescription>
              Run component deliveries to establish the quality baseline.
            </AlertDescription>
          </Alert>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Run pass rate"
            value={percent(metrics.runPassRate)}
            detail={`${metrics.passedRuns} of ${metrics.runs} runs passed`}
            icon={Gauge}
          />
          <MetricCard
            label="Component pass rate"
            value={percent(metrics.componentPassRate)}
            detail={`${metrics.passedComponents} of ${metrics.components} components passed`}
            icon={CheckCircle2}
          />
          <MetricCard
            label="First-turn success"
            value={percent(metrics.firstTurnSuccessRate)}
            detail="Components passing without repair"
            icon={Sparkles}
          />
          <MetricCard
            label="Repair success"
            value={percent(metrics.repairSuccessRate)}
            detail="Failed attempts recovered by the same agent"
            icon={Bot}
          />
          <MetricCard
            label="Visual gates"
            value={percent(metrics.visualGatePassRate)}
            detail={`Accessibility ${percent(metrics.accessibilityGatePassRate)}`}
            icon={ShieldCheck}
          />
          <MetricCard
            label="Average runtime"
            value={duration(metrics.averageComponentRuntimeMs)}
            detail={`Merge conflicts ${percent(metrics.mergeConflictRate)}`}
            icon={Clock3}
          />
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Release thresholds</CardTitle>
              <CardDescription>These gates also drive the headless CLI verdict.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {report.data.thresholds.map((item) => {
                const rate = item.id === "sample-size" ? null : item.actual;
                return (
                  <div className="space-y-2" key={item.id}>
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        {item.passed ? (
                          <CheckCircle2 className="size-4 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="size-4 text-destructive" />
                        )}
                        {item.label}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.id === "sample-size" ? item.actual : percent(item.actual)}{" "}
                        {item.operator}{" "}
                        {item.id === "sample-size" ? item.target : percent(item.target)}
                      </span>
                    </div>
                    {rate !== null && <Progress value={Math.min(rate * 100, 100)} />}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitMerge className="size-4 text-primary" />
                Provider comparison
              </CardTitle>
              <CardDescription>Pass rate and runtime by agent SDK.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {report.data.providers.length === 0 ? (
                <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No provider results yet.
                </div>
              ) : (
                report.data.providers.map((provider) => (
                  <div className="rounded-lg border p-3" key={provider.provider}>
                    <div className="flex items-center justify-between gap-3">
                      <strong className="capitalize">{provider.provider}</strong>
                      <Badge variant="secondary">{percent(provider.passRate)}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {provider.passedComponents}/{provider.components} passed ·{" "}
                      {duration(provider.averageRuntimeMs)} average
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
