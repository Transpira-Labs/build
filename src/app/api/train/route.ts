// POST /api/train  — start a managed-RL training job; returns { jobId }. Requires
//   API access (admin-granted) — see src/lib/access.ts.
// GET  /api/train?jobId=…  — poll job status.
//
// Runs as a background job in the synth backend (remote via SYNTH_BACKEND_URL, or
// the local train_one.py CLI in dev). Training runs many rollouts on HUD and
// takes minutes-to-hours, so the client polls rather than holding a request open.

import { gatedJobPOST, jobGET } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = gatedJobPOST({
  jobKind: "train",
  prepare: (body) => {
    const blocks = Array.isArray(body.blocks) && body.blocks.length > 0 ? body.blocks : undefined;
    const taskset = typeof body.taskset === "string" ? body.taskset.trim() : "";
    if (!blocks && !taskset) return { error: "blocks[] or taskset required" };
    return {
      jobBody: {
        blocks,
        taskset: taskset || undefined,
        name: typeof body.name === "string" ? body.name : undefined,
        base: typeof body.base === "string" ? body.base : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        steps: typeof body.steps === "number" ? body.steps : undefined,
        group: typeof body.group === "number" ? body.group : undefined,
        mode: typeof body.mode === "string" ? body.mode : undefined,
        baseline: body.baseline && typeof body.baseline === "object" ? body.baseline : undefined,
        fork: typeof body.fork === "boolean" ? body.fork : undefined,
        dryRun: body.dryRun === true,
      },
    };
  },
});

export const GET = jobGET;
