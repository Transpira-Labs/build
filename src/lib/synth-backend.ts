// Server-only: run the synth deploy/eval pipeline as a job, either by proxying
// to the remote Python service (SYNTH_BACKEND_URL — production, on Vercel) or by
// spawning the local CLIs (localhost dev). Either way the caller gets a jobId and
// polls getJob() — deploys/evals take minutes, past Vercel's 300s function cap.
//
// Job ids are prefixed: "r:" = remote (proxy to the service), local ids have no
// prefix (read from the in-process map, kept on globalThis to survive HMR).

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export type JobKind = "deploy" | "eval" | "train";
type Job = { status: "running" | "done" | "error"; result: unknown; log: string };
type StartResult = { jobId?: string; error?: string; status?: number };

const jobs: Map<string, Job> =
  ((globalThis as Record<string, unknown>).__synthJobs as Map<string, Job>) ??
  ((globalThis as Record<string, unknown>).__synthJobs = new Map());

// Normalize SYNTH_BACKEND_URL: strip a trailing slash and add an https:// scheme
// if it's missing (e.g. a bare Railway host like "foo.up.railway.app"), so
// fetch() gets a parseable absolute URL.
const remoteUrl = () => {
  const raw = process.env.SYNTH_BACKEND_URL?.trim().replace(/\/$/, "");
  if (!raw) return undefined;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
};
const secretHeaders = (): Record<string, string> =>
  process.env.SYNTH_API_SECRET ? { "X-Synth-Secret": process.env.SYNTH_API_SECRET } : {};

type DeployBody = { blocks: unknown[]; dryRun?: boolean; noLlm?: boolean };
type EvalBody = {
  blocks?: unknown[];
  taskset?: string;
  models?: string[];
  group?: number;
  dryRun?: boolean;
};
type TrainBody = {
  blocks?: unknown[];
  taskset?: string;
  name?: string;
  base?: string;
  model?: string;
  steps?: number;
  group?: number;
  mode?: string;
  baseline?: unknown;
  fork?: boolean;
  dryRun?: boolean;
};
type AnyBody = DeployBody | EvalBody | TrainBody;

export async function startJob(kind: JobKind, body: AnyBody): Promise<StartResult> {
  const url = remoteUrl();
  if (url) {
    try {
      const res = await fetch(`${url}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...secretHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { error: `deploy service ${res.status}: ${detail.slice(0, 300)}`, status: 502 };
      }
      const data = (await res.json()) as { job_id?: string };
      if (!data.job_id) return { error: "service returned no job_id", status: 502 };
      return { jobId: `r:${data.job_id}` };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "service unreachable", status: 502 };
    }
  }
  return startLocal(kind, body);
}

export async function getJob(
  jobId: string,
): Promise<{ status: string; result: unknown } | null> {
  if (jobId.startsWith("r:")) {
    const url = remoteUrl();
    if (!url) return null;
    try {
      const res = await fetch(`${url}/jobs/${jobId.slice(2)}`, { headers: secretHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { status: string; result: unknown };
    } catch {
      return null;
    }
  }
  const j = jobs.get(jobId);
  if (!j) return null;
  return { status: j.status, result: j.result };
}

function startLocal(kind: JobKind, body: AnyBody): StartResult {
  const repoRoot = process.cwd();
  const backendDir = path.join(repoRoot, "backend");
  const py = path.resolve(repoRoot, process.env.SYNTH_PYTHON || "./backend/.venv/bin/python");
  const script =
    kind === "deploy" ? "deploy_one.py" : kind === "eval" ? "eval_one.py" : "train_one.py";

  if (!fs.existsSync(py) || !fs.existsSync(path.join(backendDir, script))) {
    return {
      error:
        "No deploy backend. Set SYNTH_BACKEND_URL (the hosted service) or set up backend/.venv for local dev.",
      status: 503,
    };
  }
  if (!body.dryRun && !process.env.HUD_API_KEY && !fs.existsSync(`${process.env.HOME}/.hud/.env`)) {
    return { error: "No HUD_API_KEY available to the backend.", status: 503 };
  }

  // deploy_one.py reads the raw blocks array; eval_one.py / train_one.py read an object.
  let stdin: string;
  if (kind === "deploy") {
    stdin = JSON.stringify((body as DeployBody).blocks);
  } else if (kind === "eval") {
    const b = body as EvalBody;
    stdin = JSON.stringify({
      blocks: b.blocks,
      taskset: b.taskset,
      models: b.models,
      group: b.group,
    });
  } else {
    const b = body as TrainBody;
    stdin = JSON.stringify({
      blocks: b.blocks,
      taskset: b.taskset,
      name: b.name,
      base: b.base,
      model: b.model,
      steps: b.steps,
      group: b.group,
      mode: b.mode,
      baseline: b.baseline,
      fork: b.fork,
    });
  }
  const args: string[] = [];
  if (body.dryRun) args.push("--dry-run");
  if (kind === "deploy" && (body as DeployBody).noLlm) args.push("--no-llm");

  // Drop platform's HUD_API_URL (deploy/eval need the hud beta default); pass the
  // key only if non-empty so the gateway's ~/.hud/.env fallback isn't blocked.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.HUD_API_URL;
  if (process.env.HUD_API_KEY) env.HUD_API_KEY = process.env.HUD_API_KEY;
  else delete env.HUD_API_KEY;

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: "running", result: null, log: "" });

  const child = spawn(py, [script, ...args], { cwd: backendDir, env });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => {
    err += d.toString();
    const j = jobs.get(jobId);
    if (j) j.log = err;
  });
  child.stdin.write(stdin);
  child.stdin.end();
  child.on("close", () => {
    const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(line);
    } catch {
      result = { ok: false, error: "backend returned no JSON", stdoutTail: out.slice(-2000) };
    }
    result.logTail = err.slice(-6000);
    const j = jobs.get(jobId);
    if (j) {
      j.result = result;
      j.status = "done";
    }
  });
  child.on("error", (e) => {
    const j = jobs.get(jobId);
    if (j) {
      j.status = "error";
      j.result = { ok: false, error: `spawn failed: ${e.message}` };
    }
  });

  return { jobId };
}
