// Client helper: re-sync a project's taskset to HUD without a full rebuild.
// Used by the deploy modal and the run page when a deploy succeeded but the
// taskset sync didn't. Recompiles offline server-side (see backend/sync_tasks.py)
// and re-uploads the rows — no `hud deploy`, no LLM.

import type { ProjectDoc } from "@/lib/blocks/model";
import { toIR } from "@/lib/ir/schema";
import { toV1Blocks } from "@/lib/ir/v1";

export type ResyncResult = {
  ok?: boolean;
  taskset?: string;
  taskset_synced?: boolean;
  taskset_error?: string;
  count?: number;
  error?: string;
};

export async function resyncTasks(doc: ProjectDoc, envName?: string): Promise<ResyncResult> {
  try {
    const res = await fetch("/api/resync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: toV1Blocks(toIR(doc)), env_name: envName }),
    });
    return (await res.json().catch(() => ({}))) as ResyncResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error." };
  }
}
