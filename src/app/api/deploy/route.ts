// POST /api/deploy  — start a compile+deploy job; returns { jobId }. Requires
//   API access (admin-granted) — see src/lib/access.ts.
// GET  /api/deploy?jobId=…  — poll job status.
//
// The work (compile → `hud deploy`) runs as a background job in the synth backend
// — remotely via SYNTH_BACKEND_URL (production) or locally by spawning the CLI
// (dev). Deploys take minutes, so the client polls instead of holding one request.

import { gatedJobPOST, jobGET } from "@/lib/access";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = gatedJobPOST({
  jobKind: "deploy",
  prepare: (body) => {
    if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
      return { error: "blocks[] required" };
    }
    return {
      jobBody: {
        blocks: body.blocks,
        dryRun: body.dryRun === true,
        noLlm: body.noLlm === true,
      },
    };
  },
});

export const GET = jobGET;
