// POST /api/resync  — re-sync a project's taskset to HUD without a full rebuild.
// Body: { blocks: v1Blocks, env_name?: string }. Returns the sync result
// ({ ok, taskset, taskset_synced, count, taskset_error }). Use when the env
// already deployed but `hud sync tasks` failed — recompiles offline (no LLM, no
// `hud deploy`) and just re-uploads the taskset rows. See backend/sync_tasks.py.

import { runPythonOnce } from "@/lib/synth-backend";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { blocks?: unknown; env_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
    return Response.json({ error: "blocks[] required" }, { status: 400 });
  }
  const data = await runPythonOnce("sync_tasks", {
    blocks: body.blocks,
    env_name: typeof body.env_name === "string" ? body.env_name : undefined,
  });
  return Response.json(data);
}
