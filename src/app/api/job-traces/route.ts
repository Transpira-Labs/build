// GET /api/job-traces?jobId=<hud_job_id>  — live per-trace status + reward for a
// HUD job. Reads /jobs/<id>/traces off HUD (beta) via backend/job_traces.py and
// returns { ok, traces: [{ id, status, reward, error }], mean_reward, job_url }.
// The run page polls this while a run is in flight to show pending/running
// rollouts and surface scores as they land.

import { runPythonOnce } from "@/lib/synth-backend";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  const data = await runPythonOnce("job_traces", { job_id: jobId });
  return Response.json(data);
}
