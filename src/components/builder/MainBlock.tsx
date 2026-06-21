"use client";

// A top-level main block on the canvas. Freely positioned, dragged to move by
// its header, and a drop target for its child blocks (which may themselves nest).

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { BLOCKS, canAdd, type Block, type BlockKind } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { BlockNode } from "./BlockNode";
import { HelpPopover } from "./HelpPopover";
import { CloseIcon } from "./icons";

export function MainBlock({
  block,
  activeChildKind,
}: {
  block: Block;
  activeChildKind: BlockKind | null;
}) {
  const { dispatch } = useProject();
  const { kids } = useKidsMode();
  const def = BLOCKS[block.kind];

  const {
    setNodeRef: setMoveRef,
    listeners,
    attributes,
    transform,
    isDragging,
  } = useDraggable({
    id: `move:${block.id}`,
    data: { type: "move", id: block.id },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${block.id}`,
    data: { type: "container", blockId: block.id },
  });

  const accepts = activeChildKind ? canAdd(block, activeChildKind) : false;

  const style: React.CSSProperties = {
    left: block.x ?? 0,
    top: block.y ?? 0,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 50 : undefined,
    width: 320,
    borderTopColor: def.color,
    "--block-color": def.color,
  } as React.CSSProperties;

  return (
    <div
      ref={setMoveRef}
      style={style}
      onPointerDown={() => dispatch({ type: "bringToFront", id: block.id })}
      className={`kids-block absolute select-none rounded-lg border border-t-[3px] border-border bg-card shadow-[0_4px_16px_-6px_rgba(60,40,20,0.25)] ${
        accepts ? "ring-2 ring-accent ring-offset-1" : ""
      }`}
    >
      {/* Header — drag handle */}
      <div
        {...listeners}
        {...attributes}
        className="flex cursor-grab touch-none items-center gap-2 px-3 py-2 active:cursor-grabbing"
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: def.color }}
        >
          {def.label}
        </span>
        <span onPointerDown={(e) => e.stopPropagation()}>
          <HelpPopover kind={block.kind} />
        </span>
        {def.hasName && (
          <input
            value={block.name ?? ""}
            onChange={(e) =>
              dispatch({ type: "renameBlock", id: block.id, name: e.target.value })
            }
            onPointerDown={(e) => e.stopPropagation()}
            placeholder={`name this ${def.label.toLowerCase()}`}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-display text-sm font-semibold outline-none hover:border-border focus:border-accent focus:ring-2 focus:ring-ring"
          />
        )}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => dispatch({ type: "removeBlock", id: block.id })}
          className="ml-auto rounded p-0.5 text-muted-foreground/40 hover:bg-muted hover:text-destructive"
          aria-label={`Remove ${def.label}`}
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body — drop target */}
      <div
        ref={setDropRef}
        style={{ backgroundColor: def.tint }}
        className="space-y-1.5 rounded-b-lg border-t border-border px-2.5 py-2.5"
      >
        <SortableContext
          items={block.children.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {block.children.map((child) => (
            <BlockNode
              key={child.id}
              block={child}
              parentId={block.id}
              activeChildKind={activeChildKind}
            />
          ))}
        </SortableContext>

        <div
          className={`rounded-md border border-dashed px-3 py-2 text-center text-xs font-medium transition-colors ${
            accepts || isOver
              ? "border-accent bg-accent/5 text-accent"
              : "border-border text-muted-foreground/60"
          }`}
        >
          {kids ? "Snap blocks here" : "Drag blocks here"}
        </div>
      </div>
    </div>
  );
}
