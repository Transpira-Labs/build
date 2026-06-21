// POST /api/run  — start a run of the deployed HUD taskset; returns { jobId }.
// GET  /api/run?jobId=…  — poll status; returns { status, result, hudJobId }.
//
// The job runs every task in the deployed taskset group-times on HUD's remote
// runtime (see backend/run_taskset.py). As soon as the bridge reports the HUD
// job id (hudJobId), the client can poll /api/job-traces for live per-trace
// pending/running status while the run finishes.

import { startJob, getJob } from "@/lib/synth-backend";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { taskset?: unknown; model?: unknown; group?: unknown; task_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const taskset = typeof body.taskset === "string" ? body.taskset.trim() : "";
  if (!taskset) {
    return Response.json({ error: "taskset required" }, { status: 400 });
  }
  const r = await startJob("run", {
    taskset,
    model: typeof body.model === "string" ? body.model : undefined,
    group: typeof body.group === "number" ? body.group : undefined,
    task_ids: Array.isArray(body.task_ids) ? (body.task_ids as string[]) : undefined,
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
