// POST /api/deploy  — start a compile+deploy job; returns { jobId }.
// GET  /api/deploy?jobId=…  — poll job status; returns { status, result }.
//
// The work (compile → `hud deploy`) runs as a background job in the synth backend
// — remotely via SYNTH_BACKEND_URL (production) or locally by spawning the CLI
// (dev). Deploys take minutes, so the client polls instead of holding one request.

import { startJob, getJob } from "@/lib/synth-backend";

export const runtime = "nodejs";
// Start/poll are quick (the job runs in the background), so this is well under
// Vercel's 300s cap.
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { blocks?: unknown; dryRun?: boolean; noLlm?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
    return Response.json({ error: "blocks[] required" }, { status: 400 });
  }
  const r = await startJob("deploy", {
    blocks: body.blocks,
    dryRun: !!body.dryRun,
    noLlm: !!body.noLlm,
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
