// A stable signature of what a project would actually deploy — the v1 blocks
// sent to the backend. The run page compares the current signature against the
// one captured at build time (DeployInfo.builtHash) to warn when the environment
// has changed since the last build. Layout-only edits (block position / width)
// don't affect the v1 blocks, so they correctly don't trigger a stale warning.

import type { ProjectDoc } from "@/lib/blocks/model";
import { toIR } from "@/lib/ir/schema";
import { toV1Blocks } from "@/lib/ir/v1";

export function buildSignature(doc: ProjectDoc): string {
  const json = JSON.stringify(toV1Blocks(toIR(doc)));
  // FNV-1a (32-bit) — small, dependency-free, good enough to detect any change.
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
