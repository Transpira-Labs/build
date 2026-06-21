"use client";

// /build/[id]/runs — run examples on the deployed HUD env and show how the
// models performed. Runs a baseline eval (per-model × group rollouts) through
// the Python bridge (POST /api/eval) and renders the leaderboard: per-task
// rewards, per-model means, and the solvable/discriminating verdicts.

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, Play, Rocket } from "lucide-react";
import { useEnvironment } from "@/lib/library";
import { toIR } from "@/lib/ir/schema";
import { toV1Blocks } from "@/lib/ir/v1";

// Mirrors the backend's DEFAULT_MODELS (a spanning weak→strong set).
const MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5", tier: "fast" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", tier: "balanced" },
  { id: "claude-opus-4-8", label: "Opus 4.8", tier: "strong" },
];

type Leaderboard = {
  ok: boolean;
  group: number;
  ceiling: number;
  solvable: boolean;
  discriminating: boolean;
  models: { model: string; mean: number; per_task: Record<string, number> }[];
  tasks: {
    slug: string;
    best: number;
    worst: number;
    per_model: Record<string, number>;
    dead: boolean;
    saturated: boolean;
    has_spread: boolean;
  }[];
  diagnostics: { level: string; code: string; message: string; task_id?: string | null }[];
  error?: string;
  logTail?: string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Warm green→amber→red wash by reward (0..1). */
function rewardStyle(v: number): React.CSSProperties {
  const hue = Math.round(v * 130); // 0 red → 130 green
  return {
    backgroundColor: `oklch(0.92 0.07 ${hue})`,
    color: `oklch(0.32 0.06 ${hue})`,
  };
}

export default function RunsPage() {
  const { id } = useParams<{ id: string }>();
  const { doc, ready } = useEnvironment(id);

  const [models, setModels] = useState<string[]>(["claude-haiku-4-5"]);
  const [group, setGroup] = useState(3);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <div className="canvas-grid h-screen w-full" />;

  const deploy = doc?.deploy;

  async function run() {
    if (!doc || !deploy) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: toV1Blocks(toIR(doc)), models, group }),
      });
      const data: Leaderboard = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Eval failed.");
        setResult(data);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setRunning(false);
    }
  }

  function toggleModel(m: string) {
    setModels((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <Link
          href={`/build/${id}`}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Editor
        </Link>
        <span className="h-4 w-px bg-border" />
        <p className="text-sm font-semibold">{doc?.name || "Environment"} · Runs</p>
        {deploy && (
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Rocket className="size-3.5 text-accent" />
            <span className="font-mono text-foreground">{deploy.envName}</span>
            {deploy.envUrl && (
              <a
                href={deploy.envUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 hover:text-foreground"
              >
                on HUD <ExternalLink className="size-3" />
              </a>
            )}
          </span>
        )}
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6">
        {!deploy ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Rocket className="mx-auto size-8 text-foreground/20" />
            <p className="mt-3 text-sm font-medium">Nothing deployed yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Go back and hit <span className="font-semibold">Build it</span> to deploy this
              environment to HUD first.
            </p>
            <Link
              href={`/build/${id}`}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90"
            >
              <ArrowLeft className="size-3.5" /> Back to editor
            </Link>
          </div>
        ) : (
          <>
            {/* Run controls */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">Run examples</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Each model attempts every task {group}× on HUD; we average the rewards to
                show how it did. Real runs use HUD compute.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {MODELS.map((m) => {
                  const on = models.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleModel(m.id)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        on
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <label className="text-muted-foreground" htmlFor="group">
                    Attempts each
                  </label>
                  <input
                    id="group"
                    type="number"
                    min={1}
                    max={12}
                    value={group}
                    onChange={(e) => setGroup(Math.min(12, Math.max(1, Number(e.target.value))))}
                    className="w-14 rounded-md border border-input bg-background px-2 py-1 text-center outline-none focus:border-accent"
                  />
                </div>
              </div>

              <button
                onClick={run}
                disabled={running || models.length === 0}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-60"
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Running on HUD…
                  </>
                ) : (
                  <>
                    <Play className="size-4" /> Run {models.length} model
                    {models.length === 1 ? "" : "s"}
                  </>
                )}
              </button>
              {running && (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Rollouts run on HUD and can take a few minutes — keep this tab open.
                </p>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-700">{error}</p>
                {result?.logTail && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-red-600">Log</summary>
                    <pre className="mt-1 max-h-48 overflow-auto font-mono text-[10px] text-red-700/80">
                      {result.logTail}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {result?.ok && <Results lb={result} />}
          </>
        )}
      </div>
    </div>
  );
}

function Results({ lb }: { lb: Leaderboard }) {
  return (
    <div className="mt-5 space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2">
        <Stat label="Ceiling" value={pct(lb.ceiling)} hint="best model's avg reward" />
        <Badge ok={lb.solvable} label={lb.solvable ? "Solvable" : "Unsolvable"} />
        <Badge
          ok={lb.discriminating}
          label={lb.discriminating ? "Discriminating" : "No signal"}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {lb.group}× per task
        </span>
      </div>

      {/* Per-model leaderboard */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <p className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          How each model did
        </p>
        <ul className="divide-y divide-border">
          {lb.models.map((m, i) => (
            <li key={m.model} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-4 text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <span className="w-36 truncate font-mono text-xs text-foreground">{m.model}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round(m.mean * 100)}%` }}
                />
              </div>
              <span className="w-10 text-right text-xs font-semibold">{pct(m.mean)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Per-task reward matrix */}
      {lb.tasks.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Per task
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Task</th>
                {lb.models.map((m) => (
                  <th key={m.model} className="px-3 py-2 text-center font-medium">
                    {m.model.replace("claude-", "")}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lb.tasks.map((t) => (
                <tr key={t.slug}>
                  <td className="max-w-[14rem] truncate px-4 py-2 font-mono text-foreground/80">
                    {t.slug}
                  </td>
                  {lb.models.map((m) => {
                    const v = t.per_model[m.model] ?? 0;
                    return (
                      <td key={m.model} className="px-2 py-2 text-center">
                        <span
                          className="inline-block min-w-9 rounded px-1.5 py-0.5 text-[11px] font-semibold"
                          style={rewardStyle(v)}
                        >
                          {pct(v)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-right">
                    {t.dead ? (
                      <span className="text-red-500">dead</span>
                    ) : t.saturated ? (
                      <span className="text-amber-500">too easy</span>
                    ) : !t.has_spread ? (
                      <span className="text-muted-foreground">flat</span>
                    ) : (
                      <span className="text-green-600">good</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Diagnostics */}
      {lb.diagnostics.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-border bg-card p-3">
          {lb.diagnostics.map((d, i) => (
            <li key={i} className="flex gap-2 text-xs">
              <span
                className={
                  d.level === "error"
                    ? "text-red-500"
                    : d.level === "warn"
                      ? "text-amber-500"
                      : "text-muted-foreground"
                }
              >
                ●
              </span>
              <span className="text-muted-foreground">
                {d.task_id && <span className="font-mono text-foreground/70">{d.task_id}: </span>}
                {d.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-1.5">
      <span className="text-sm font-bold text-foreground">{value}</span>{" "}
      <span className="text-xs text-muted-foreground" title={hint}>
        {label}
      </span>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
        ok
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {label}
    </span>
  );
}
