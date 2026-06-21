// POST /api/train  — start a managed-RL training job; returns { jobId }.
// GET  /api/train?jobId=…  — poll job status; returns { status, result }.
//
// Runs as a background job in the synth backend (remote via SYNTH_BACKEND_URL, or
// the local train_one.py CLI in dev). Training runs many rollouts on HUD and
// takes minutes-to-hours, so the client polls rather than holding a request open.

import { startJob, getJob } from "@/lib/synth-backend";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: {
    blocks?: unknown;
    taskset?: unknown;
    name?: unknown;
    base?: unknown;
    model?: unknown;
    steps?: unknown;
    group?: unknown;
    mode?: unknown;
    baseline?: unknown;
    fork?: unknown;
    dryRun?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const blocks = Array.isArray(body.blocks) && body.blocks.length > 0 ? body.blocks : undefined;
  const taskset = typeof body.taskset === "string" ? body.taskset.trim() : "";
  if (!blocks && !taskset) {
    return Response.json({ error: "blocks[] or taskset required" }, { status: 400 });
  }
  const r = await startJob("train", {
    blocks,
    taskset: taskset || undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    base: typeof body.base === "string" ? body.base : undefined,
    model: typeof body.model === "string" ? body.model : undefined,
    steps: typeof body.steps === "number" ? body.steps : undefined,
    group: typeof body.group === "number" ? body.group : undefined,
    mode: typeof body.mode === "string" ? body.mode : undefined,
    baseline:
      body.baseline && typeof body.baseline === "object" ? body.baseline : undefined,
    fork: typeof body.fork === "boolean" ? body.fork : undefined,
    dryRun: !!body.dryRun,
  });
  if (r.error) return Response.json({ error: r.error }, { status: r.status ?? 500 });
  return Response.json({ jobId: r.jobId });
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const job = await getJob(jobId);
  if (!job) return Response.json({ error: "job not found" }, { status: 404 });
  return Response.json(job);
}
