"use client";

// Draggable blocks in the palette. A "main" item drags onto the canvas and can
// be expanded to reveal the detail blocks that go under it. A "sub" item drags
// into a container (indented by how deep it nests).
//
// Each block carries `kids-block` + a `--block-color` var; the Scratch-style
// connector tabs those drive are defined in globals.css and only show in kids
// mode. Labels, colours, and copy are identical in both modes.

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
      style={{ borderLeftColor: def.color, "--block-color": def.color } as React.CSSProperties}
      className="kids-block relative flex items-center rounded-md border border-border border-l-[3px] bg-card shadow-sm"
    >
      <button
        onClick={onToggle}
        className="flex shrink-0 items-center px-1.5 py-2 text-muted-foreground hover:text-foreground"
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
        style={{ opacity: isDragging ? 0.4 : disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "grab" }}
        className="flex flex-1 touch-none items-center gap-2 py-2 pr-2 text-left"
        title={disabled ? "Already on the canvas" : `Drag “${def.label}” onto the canvas`}
      >
        <span className="font-display text-sm font-semibold">{def.label}</span>
        {disabled && (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-green-600">
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
  // level of nesting (double sub-blocks indent twice). Shrink the width by the
  // same amount so the indented block stays inside the column instead of
  // overflowing off the right edge.
  const indent = (depth + 1) * 16;

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: def.color,
        "--block-color": def.color,
        marginLeft: indent,
        width: `calc(100% - ${indent}px)`,
      } as React.CSSProperties}
      className="kids-block relative flex cursor-grab touch-none items-center gap-2 rounded-md border border-border border-l-2 bg-card px-2.5 py-1.5 text-left text-sm shadow-sm hover:bg-muted/40 active:cursor-grabbing"
      title={def.hint}
    >
      <span className="font-medium">{def.label}</span>
      <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
        {def.role === "group" && (
          <span className="text-muted-foreground/60">holds more</span>
        )}
        {required && <span className="text-accent">needed</span>}
        {def.repeatable && <span className="text-muted-foreground/60">many</span>}
      </span>
    </button>
  );
}
