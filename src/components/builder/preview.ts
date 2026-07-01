// One-line content summaries shown inline in a block's header when collapsed.

import { BLOCKS, type Block } from "@/lib/blocks/model";

/** A short, muted preview of a block's content for the collapsed header. */
export function previewOf(block: Block): string {
  const def = BLOCKS[block.kind];

  if (def.role === "main" || def.role === "group") {
    const n = block.children.length;
    return n === 0 ? "empty" : `${n} block${n === 1 ? "" : "s"}`;
  }

  switch (def.valueType) {
    case "text":
      return block.text?.trim() || "-";
    case "choice":
      return (
        def.options?.find((o) => o.value === block.text)?.label ??
        block.text ??
        "-"
      );
    case "number":
      return `${block.num ?? def.number?.default ?? ""} ${def.number?.unit ?? ""}`.trim();
    case "reference":
      return block.reference?.value?.trim() || block.reference?.mode || "-";
    default:
      return "-";
  }
}
