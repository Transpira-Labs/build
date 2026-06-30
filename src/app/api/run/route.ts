// POST /api/run  — start a run of the deployed HUD taskset; returns { jobId }.
//   Requires API access (admin-granted) — see src/lib/access.ts.
// GET  /api/run?jobId=…  — poll status.
//
// The job runs every task in the deployed taskset group-times on HUD's remote
// runtime (see backend/run_taskset.py). As soon as the bridge reports the HUD
// job id (hudJobId), the client can poll /api/job-traces for live per-trace
// pending/running status while the run finishes.

import { gatedJobPOST, jobGET } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = gatedJobPOST({
  jobKind: "run",
  prepare: (body) => {
    const taskset = typeof body.taskset === "string" ? body.taskset.trim() : "";
    if (!taskset) return { error: "taskset required" };
    return {
      jobBody: {
        taskset,
        model: typeof body.model === "string" ? body.model : undefined,
        group: typeof body.group === "number" ? body.group : undefined,
        task_ids: Array.isArray(body.task_ids) ? (body.task_ids as string[]) : undefined,
      },
    };
  },
});

export const GET = jobGET;
