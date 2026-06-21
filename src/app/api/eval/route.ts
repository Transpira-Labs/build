// POST /api/eval  — start a baseline-eval job; returns { jobId }.
// GET  /api/eval?jobId=…  — poll job status; returns { status, result }.
//
// Runs as a background job in the synth backend (remote via SYNTH_BACKEND_URL, or
// local CLI in dev). Evals run rollouts on HUD and take minutes, so the client
// polls rather than holding one request open.

import { startJob, getJob } from "@/lib/synth-backend";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: {
    blocks?: unknown;
    taskset?: unknown;
    models?: unknown;
    group?: unknown;
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
  const r = await startJob("eval", {
    blocks,
    taskset: taskset || undefined,
    models: Array.isArray(body.models) ? (body.models as string[]) : undefined,
    group: typeof body.group === "number" ? body.group : undefined,
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
