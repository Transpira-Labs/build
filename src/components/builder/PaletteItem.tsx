"use client";

// Draggable blocks in the palette — the compact, header-only version of a block:
// a solid coloured pill in the block's colour, no body. A "main" item drags onto
// the canvas (and expands to reveal its detail blocks); a "sub" item drags into
// a container, indented by how deep it nests.

import { useDraggable } from "@dnd-kit/core";
import { BLOCKS, type BlockKind, type MainKind } from "@/lib/blocks/model";
import { CheckIcon, ChevronIcon } from "./icons";

export function MainPaletteItem({
  kind,
  disabled,
  expanded,
  onToggle,
}: {
  kind: MainKind;
  disabled?: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const def = BLOCKS[kind];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-main:${kind}`,
    data: { type: "palette-main", kind },
    disabled,
  });

  return (
    <div
      style={{
        "--block-color": def.color,
        opacity: isDragging ? 0.4 : disabled ? 0.6 : 1,
      } as React.CSSProperties}
      className="blk relative flex overflow-hidden rounded-md blk-shadow"
    >
      <button
        onClick={onToggle}
        className="blk-header flex shrink-0 items-center px-1.5 text-white/70 hover:text-white"
        aria-label={expanded ? "Hide blocks" : "Show blocks"}
        aria-expanded={expanded}
      >
        <ChevronIcon className="h-3.5 w-3.5" open={expanded} />
      </button>
      <button
        ref={setNodeRef}
        {...(disabled ? {} : attributes)}
        {...(disabled ? {} : listeners)}
        disabled={disabled}
        style={{ cursor: disabled ? "not-allowed" : "grab" }}
        className="blk-header flex flex-1 touch-none items-center gap-2 py-2 pr-2 text-left text-white"
        title={disabled ? "Already on the canvas" : `Drag “${def.label}” onto the canvas`}
      >
        <span className="font-display text-sm font-bold">{def.label}</span>
        {disabled && (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-white/85">
            <CheckIcon className="h-3 w-3" /> added
          </span>
        )}
      </button>
    </div>
  );
}

export function SubPaletteItem({
  kind,
  from,
  required,
  depth = 0,
}: {
  kind: BlockKind;
  /** The main section this detail was listed under — where it spawns if dropped homeless. */
  from: MainKind;
  required?: boolean;
  depth?: number;
}) {
  const def = BLOCKS[kind];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-sub:${from}:${kind}`,
    data: { type: "palette-sub", kind, from },
  });

  // Indent one tier past the parent main block, stepping further for each extra
  // level of nesting; shrink width to match so it stays inside the column.
  const indent = (depth + 1) * 16;

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        opacity: isDragging ? 0.4 : 1,
        "--block-color": def.color,
        marginLeft: indent,
        width: `calc(100% - ${indent}px)`,
      } as React.CSSProperties}
      className="blk relative blk-shadow blk-header flex cursor-grab touch-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-white active:cursor-grabbing"
      title={def.hint}
    >
      <span className="font-semibold">{def.label}</span>
      <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
        {def.role === "group" && <span>holds more</span>}
        {required && <span className="text-white">needed</span>}
        {def.repeatable && <span>many</span>}
      </span>
    </button>
  );
}
