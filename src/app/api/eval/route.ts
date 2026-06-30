// POST /api/eval  — start a baseline-eval job; returns { jobId }. Requires API
//   access (admin-granted) — see src/lib/access.ts.
// GET  /api/eval?jobId=…  — poll job status.
//
// Runs as a background job in the synth backend (remote via SYNTH_BACKEND_URL, or
// local CLI in dev). Evals run rollouts on HUD and take minutes, so the client
// polls rather than holding one request open.

import { gatedJobPOST, jobGET } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = gatedJobPOST({
  jobKind: "eval",
  prepare: (body) => {
    const blocks = Array.isArray(body.blocks) && body.blocks.length > 0 ? body.blocks : undefined;
    const taskset = typeof body.taskset === "string" ? body.taskset.trim() : "";
    if (!blocks && !taskset) return { error: "blocks[] or taskset required" };
    return {
      jobBody: {
        blocks,
        taskset: taskset || undefined,
        models: Array.isArray(body.models) ? (body.models as string[]) : undefined,
        group: typeof body.group === "number" ? body.group : undefined,
        dryRun: body.dryRun === true,
      },
    };
  },
});

export const GET = jobGET;
