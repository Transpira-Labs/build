"use client";

// /build/[id]/runs — run examples on the deployed HUD env and show how the
// models performed. Runs a baseline eval (per-model × group rollouts) through
// the Python bridge (POST /api/eval) and renders the leaderboard: per-task
// rewards, per-model means, and the solvable/discriminating verdicts.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  CircleCheck,
  ExternalLink,
  Hammer,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { saveEnvironment, useEnvironment } from "@/lib/library";
import { BLOCKS, type ProjectDoc, type DeployInfo } from "@/lib/blocks/model";
import { toIR } from "@/lib/ir/schema";
import { toV1Blocks } from "@/lib/ir/v1";
import { buildSignature } from "@/lib/buildSig";
import { resyncTasks } from "@/lib/resync";
import { runJob } from "@/lib/pollJob";
import { apiErrorFrom } from "@/lib/apiError";

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

// Shape of train_one.py's TrainingResult.to_dict() (+ run params it echoes back).
type TrainResult = {
  ok: boolean;
  model_slug: string;
  head_id?: string | null;
  baseline_ceiling?: number | null;
  curve: {
    start: number;
    end: number;
    best: number;
    improvement: number;
    points: { step: number; mean_reward: number }[];
  };
  diagnostics: { level: string; code: string; message: string }[];
  base?: string;
  steps?: number;
  group?: number;
  mode?: string;
  fork?: string;
  error?: string;
  logTail?: string;
};

type DeployResp = {
  env_name?: string;
  version?: string;
  deployed?: boolean;
  message?: string;
  logTail?: string;
  error?: string;
  taskset_synced?: boolean;
  taskset?: string;
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

const slugify = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "env";

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

  if (!ready) return <div className="canvas-grid h-screen w-full" />;

  const deploy = doc?.deploy;

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
            {doc && <StalenessBanner doc={doc} deploy={deploy} id={id} />}

            {doc && <HudRunPanel doc={doc} deploy={deploy} />}

            {doc && <TrainPanel doc={doc} deploy={deploy} baseline={null} />}
          </>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Staleness — the runs below test whatever was last deployed. If the project
// has changed since that build (signature mismatch), warn and offer to rebuild
// in place so the user doesn't run/train against a stale environment.
// ---------------------------------------------------------------------------

function StalenessBanner({
  doc,
  deploy,
  id,
}: {
  doc: ProjectDoc;
  deploy: DeployInfo;
  id: string;
}) {
  const [rebuilding, setRebuilding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // No captured hash → an older build from before staleness tracking; can't tell.
  const stale = !!deploy.builtHash && buildSignature(doc) !== deploy.builtHash;
  if (!stale) return null;

  async function rebuild() {
    setRebuilding(true);
    setErr(null);
    try {
      const data = await runJob<DeployResp>("/api/deploy", {
        blocks: toV1Blocks(toIR(doc)),
      });
      if (data.deployed) {
        const envUrl = (data.logTail || "").match(
          /https:\/\/hud\.ai\/environments\/[0-9a-f-]+/i,
        )?.[0];
        saveEnvironment({
          ...doc,
          deploy: {
            envName: data.env_name || deploy.envName,
            tasksetName: data.taskset || deploy.tasksetName || data.env_name || deploy.envName,
            tasksetSynced: data.taskset_synced !== false,
            envUrl: envUrl ?? deploy.envUrl,
            version: data.version,
            status: "deployed",
            deployedAt: new Date().toISOString(),
            message: data.message,
            builtHash: buildSignature(doc),
          },
        });
        // saveEnvironment is reactive — the banner unmounts once doc matches.
      } else {
        setErr(data.message || data.error || "Rebuild failed. Open the editor and try Build it.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error.");
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="text-sm">
          <p className="font-semibold text-amber-900">
            This environment has changed since the last build
          </p>
          <p className="mt-0.5 text-amber-800">
            The runs below still use the build from{" "}
            {new Date(deploy.deployedAt).toLocaleString()}. Rebuild to test and train on your
            latest edits.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={rebuild}
          disabled={rebuilding}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {rebuilding ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Rebuilding…
            </>
          ) : (
            <>
              <Hammer className="size-3.5" /> Rebuild now
            </>
          )}
        </button>
        <Link
          href={`/build/${id}`}
          className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          Open editor
        </Link>
        {rebuilding && (
          <span className="text-xs text-amber-700">
            Compiling &amp; deploying on HUD. Keep this tab open.
          </span>
        )}
      </div>
      {err && <p className="mt-2 text-xs font-medium text-red-600">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Train — one-click managed RL on the tasks you defined, routed through HUD.
// Forks a trainable open-weight base into a per-env slug, then runs GRPO
// rollouts on those tasks and reads the reward curve. If a baseline eval is on
// the page, it's passed as the trainability gate (and the climb is measured
// against its ceiling).
// ---------------------------------------------------------------------------

const BASES = BLOCKS.model.options ?? [
  { value: "qwen3-8b", label: "Small & fast" },
];

function TrainPanel({
  doc,
  deploy,
  baseline,
}: {
  doc: ProjectDoc;
  deploy: DeployInfo;
  baseline: Leaderboard | null;
}) {
  const [base, setBase] = useState(doc.train.model || BASES[0].value);
  const [steps, setSteps] = useState(10);
  const [group, setGroup] = useState(8);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TrainResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slug = `${slugify(deploy.envName)}-rl`;
  const last = doc.lastTrain;

  async function train() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await runJob<TrainResult>(
        "/api/train",
        {
          blocks: toV1Blocks(toIR(doc)),
          name: deploy.envName,
          base,
          steps,
          group,
          baseline: baseline ?? undefined,
        },
        // GRPO loops are long; give them room and poll a little less eagerly.
        { intervalMs: 5000, timeoutMs: 60 * 60 * 1000 },
      );
      setResult(data);
      const c = data.curve;
      // Persist a slim summary so the trained slug + curve survive a reload.
      saveEnvironment({
        ...doc,
        lastTrain: {
          modelSlug: data.model_slug || slug,
          base: data.base || base,
          steps: data.steps ?? steps,
          group: data.group ?? group,
          status: data.ok ? "trained" : "failed",
          startReward: c?.start,
          endReward: c?.end,
          bestReward: c?.best,
          improvement: c?.improvement,
          baselineCeiling: data.baseline_ceiling ?? undefined,
          curve: c?.points?.map((p) => ({ step: p.step, mean_reward: p.mean_reward })),
          diagnostics: data.diagnostics,
          startedAt: new Date().toISOString(),
          message: data.error,
        },
      });
      if (!data.ok) setError(data.error || "Training did not complete. See the notes below.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Brain className="size-4 text-accent" />
        <p className="text-sm font-semibold">Train a model on these tasks</p>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Forks{" "}
        <span className="font-mono text-foreground/80">{base}</span> into a trainable model{" "}
        <span className="font-mono text-foreground/80">{slug}</span> and runs RL on the tasks you
        defined, rollouts and inference both route through HUD.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Base model</span>
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 outline-none focus:border-accent"
          >
            {BASES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value}: {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Steps</span>
          <input
            type="number"
            min={1}
            max={100}
            value={steps}
            onChange={(e) => setSteps(Math.min(100, Math.max(1, Number(e.target.value))))}
            className="rounded-md border border-input bg-background px-2 py-1.5 outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Group (rollouts/task)</span>
          <input
            type="number"
            min={2}
            max={32}
            value={group}
            onChange={(e) => setGroup(Math.min(32, Math.max(2, Number(e.target.value))))}
            className="rounded-md border border-input bg-background px-2 py-1.5 outline-none focus:border-accent"
          />
        </label>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {baseline ? (
          <>
            <CircleCheck className="mr-1 inline size-3 text-green-600" />
            Gated by your baseline: GRPO needs within-group reward spread to learn.
          </>
        ) : (
          <>Tip: run a baseline above first. It gates training on whether the tasks have signal.</>
        )}
      </p>

      <button
        onClick={train}
        disabled={running}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        {running ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Training on HUD…
          </>
        ) : (
          <>
            <Sparkles className="size-4" /> Start RL run
          </>
        )}
      </button>
      {running && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {steps} steps × {group} rollouts/task on HUD. This can take a while. Keep this tab open.
        </p>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
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

      {result?.ok && <TrainResultView r={result} />}

      {/* Persisted summary from a previous run (shown until a fresh run replaces it). */}
      {!result && last && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-2">
            {last.status === "trained" ? (
              <CircleCheck className="size-3.5 text-green-600" />
            ) : (
              <TrendingUp className="size-3.5 text-amber-500" />
            )}
            <span className="font-medium">Last run</span>
            <span className="font-mono text-foreground/70">{last.modelSlug}</span>
            <span className="ml-auto text-muted-foreground">
              {typeof last.startReward === "number" && typeof last.endReward === "number"
                ? `${pct(last.startReward)} → ${pct(last.endReward)}`
                : last.status}
            </span>
          </div>
          {last.curve && last.curve.length > 1 && (
            <div className="mt-2">
              <RewardCurve points={last.curve} ceiling={last.baselineCeiling} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrainResultView({ r }: { r: TrainResult }) {
  const c = r.curve;
  const up = (c?.improvement ?? 0) >= 0;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
        <TrendingUp className={`size-4 ${up ? "text-green-600" : "rotate-180 text-amber-500"}`} />
        <div className="text-sm">
          <span className="font-semibold">
            {pct(c.start)} → {pct(c.end)}
          </span>{" "}
          <span className="text-muted-foreground">
            ({up ? "+" : ""}
            {pct(c.improvement)} over {c.points.length} checkpoint
            {c.points.length === 1 ? "" : "s"}, best {pct(c.best)})
          </span>
        </div>
        <span className="ml-auto font-mono text-xs text-foreground/70">{r.model_slug}</span>
      </div>

      {c.points.length > 1 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <RewardCurve
            points={c.points}
            ceiling={r.baseline_ceiling ?? undefined}
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Sample it through HUD as{" "}
        <span className="font-mono text-foreground/80">{r.model_slug}</span>, the trained head is
        live behind that slug.
      </p>

      {r.diagnostics && r.diagnostics.length > 0 && (
        <ul className="space-y-1.5 rounded-lg border border-border bg-card p-3">
          {r.diagnostics.map((d, i) => (
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
              <span className="text-muted-foreground">{d.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A tiny reward-vs-step sparkline. Rewards are 0..1; the optional baseline
 *  ceiling is drawn as a dashed reference line. */
function RewardCurve({
  points,
  ceiling,
}: {
  points: { step: number; mean_reward: number }[];
  ceiling?: number;
}) {
  const W = 320;
  const H = 64;
  const pad = 4;
  const n = points.length;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - Math.max(0, Math.min(1, v)) * (H - 2 * pad);
  const line = points.map((p, i) => `${x(i)},${y(p.mean_reward)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" preserveAspectRatio="none">
      {typeof ceiling === "number" && (
        <line
          x1={pad}
          x2={W - pad}
          y1={y(ceiling)}
          y2={y(ceiling)}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="4 3"
          className="text-muted-foreground/50"
        />
      )}
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-accent"
      />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.mean_reward)} r={2} className="fill-accent" />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// HUD run — launch a real job against the deployed taskset and show it live.
// One model attempts every task in the taskset group-times on HUD's remote
// runtime. As soon as the backend reports the HUD job id we poll its traces, so
// the user watches rollouts go pending → running → scored, then sees the mean.
// ---------------------------------------------------------------------------

type Trace = { id: string; status: string; reward: number | null; error?: string | null };
type RunResult = {
  ok?: boolean;
  job_id?: string;
  job_url?: string;
  model?: string;
  group?: number;
  task_count?: number;
  mean_reward?: number;
  per_task?: Record<string, number>;
  error?: string;
};

const traceTone = (status: string): string => {
  if (status === "completed" || status === "done" || status === "finished") return "text-green-600";
  if (["failed", "error", "errored", "cancelled", "canceled", "timeout"].includes(status))
    return "text-red-500";
  if (status === "running") return "text-blue-600";
  return "text-muted-foreground"; // pending / unknown
};

function HudRunPanel({ doc, deploy }: { doc: ProjectDoc; deploy: DeployInfo }) {
  const tasksetName = deploy.tasksetName || deploy.envName;
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [group, setGroup] = useState(3);
  const [jobId, setJobId] = useState<string | null>(null);
  const [hudJobId, setHudJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMsg, setResyncMsg] = useState<string | null>(null);

  // Re-sync the taskset to HUD without rebuilding the env.
  async function resync() {
    setResyncing(true);
    setResyncMsg(null);
    const r = await resyncTasks(doc, tasksetName);
    setResyncing(false);
    if (r.taskset_synced) {
      saveEnvironment({
        ...doc,
        deploy: {
          ...deploy,
          tasksetName: r.taskset || deploy.tasksetName,
          tasksetSynced: true,
        },
      });
      setResyncMsg(`Synced ${r.count ?? ""} task(s). You can run now.`);
    } else {
      setResyncMsg(r.taskset_error || r.error || "Sync failed.");
    }
  }

  // Poll our job (status + the HUD job id) and, once we have it, the live traces.
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hud = hudJobId;

    const tick = async (): Promise<boolean> => {
      const r = await fetch(`/api/run?jobId=${encodeURIComponent(jobId)}`)
        .then((x) => x.json())
        .catch(() => null);
      if (!alive || !r) return false;
      const res = (r.result ?? null) as RunResult | null;
      const newHud: string | undefined = r.hudJobId || res?.job_id;
      if (newHud && !hud) {
        hud = newHud;
        setHudJobId(newHud);
      }
      if (hud) {
        const t = await fetch(`/api/job-traces?jobId=${encodeURIComponent(hud)}`)
          .then((x) => x.json())
          .catch(() => null);
        if (alive && t?.ok && Array.isArray(t.traces)) setTraces(t.traces as Trace[]);
      }
      if (r.status === "done") {
        if (res && res.ok === false) setError(res.error || "Run failed.");
        setResult(res);
        setRunning(false);
        return true;
      }
      if (r.status === "error") {
        setError(res?.error || "Run failed.");
        setRunning(false);
        return true;
      }
      return false;
    };

    const loop = async () => {
      const stop = await tick();
      if (alive && !stop) timer = setTimeout(loop, 2500);
    };
    loop();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function launch() {
    setRunning(true);
    setError(null);
    setResult(null);
    setTraces([]);
    setHudJobId(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskset: tasksetName, model, group }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobId) {
        setError(apiErrorFrom(res.status, data, "Couldn't start the run.").message);
        setRunning(false);
        return;
      }
      setJobId(data.jobId as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setRunning(false);
    }
  }

  const counts = traces.reduce<Record<string, number>>((acc, t) => {
    const k = traceTone(t.status) === "text-green-600" ? "done"
      : traceTone(t.status) === "text-red-500" ? "failed"
      : t.status === "running" ? "running" : "pending";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const mean = result?.mean_reward;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">Run the deployed taskset on HUD</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Runs every task in{" "}
        <span className="font-mono text-foreground/80">{tasksetName}</span> {group}× on HUD&apos;s
        remote runtime, live.
      </p>

      {deploy.tasksetSynced === false && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs">
          <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />
          <span className="text-amber-800">
            Taskset isn&apos;t synced. Runs will find no tasks.
          </span>
          <button
            onClick={resync}
            disabled={resyncing}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-100 px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-60"
          >
            {resyncing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {resyncing ? "Syncing…" : "Sync tasks now"}
          </button>
        </div>
      )}
      {resyncMsg && <p className="mt-1.5 text-xs text-muted-foreground">{resyncMsg}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => setModel(m.id)}
            disabled={running}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              model === m.id
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <label className="text-muted-foreground" htmlFor="hud-group">
            Attempts each
          </label>
          <input
            id="hud-group"
            type="number"
            min={1}
            max={12}
            value={group}
            disabled={running}
            onChange={(e) => setGroup(Math.min(12, Math.max(1, Number(e.target.value))))}
            className="w-14 rounded-md border border-input bg-background px-2 py-1 text-center outline-none focus:border-accent disabled:opacity-60"
          />
        </div>
      </div>

      <button
        onClick={launch}
        disabled={running}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        {running ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Running on HUD…
          </>
        ) : (
          <>
            <Play className="size-4" /> Launch run
          </>
        )}
      </button>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Live status */}
      {(running || traces.length > 0 || result) && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {typeof mean === "number" && (
              <span className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 font-semibold text-green-700">
                Mean reward {pct(mean)}
              </span>
            )}
            {counts.running ? (
              <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-600">
                {counts.running} running
              </span>
            ) : null}
            {counts.pending ? (
              <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                {counts.pending} pending
              </span>
            ) : null}
            {counts.done ? (
              <span className="rounded-md bg-green-50 px-2 py-1 text-green-600">
                {counts.done} done
              </span>
            ) : null}
            {counts.failed ? (
              <span className="rounded-md bg-red-50 px-2 py-1 text-red-500">
                {counts.failed} failed
              </span>
            ) : null}
            {(result?.job_url || hudJobId) && (
              <a
                href={result?.job_url || `https://hud.ai/jobs/${hudJobId}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                Open job on HUD <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          {/* Per-task scores (final) */}
          {result?.per_task && Object.keys(result.per_task).length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <p className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Per task ({result.model})
              </p>
              <ul className="divide-y divide-border">
                {Object.entries(result.per_task).map(([slug, v]) => (
                  <li key={slug} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80">
                      {slug}
                    </span>
                    <span
                      className="inline-block min-w-9 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold"
                      style={rewardStyle(v)}
                    >
                      {pct(v)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Live traces */}
          {traces.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <p className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Traces ({traces.length})
              </p>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {traces.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                    <span className={`font-medium ${traceTone(t.status)}`}>● {t.status || "pending"}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-foreground/50">{t.id}</span>
                    {typeof t.reward === "number" && (
                      <span
                        className="inline-block min-w-9 rounded px-1.5 py-0.5 text-center font-semibold"
                        style={rewardStyle(t.reward)}
                      >
                        {pct(t.reward)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {running && (
            <p className="text-center text-xs text-muted-foreground">
              Rollouts run on HUD and can take a few minutes. Keep this tab open.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
