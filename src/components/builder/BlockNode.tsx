"use client";

// A nested block inside a main block — recursive. A "leaf" renders as a solid
// connectable piece (knob on top, peg below, coloured header, tinted body); a
// "group" (e.g. Scoring) renders as a nested C-block whose mouth holds more
// BlockNodes. Both are sortable within their parent and collapse to header-only.

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BLOCKS, canAdd, type Block, type BlockKind } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { FieldEditor } from "./FieldEditor";
import { HelpPopover } from "./HelpPopover";
import { previewOf } from "./preview";
import { BLOCK_ICONS } from "./blockIcons";
import { ChevronDown, ChevronRight, GripVertical, Trash2 } from "lucide-react";

export function BlockNode({
  block,
  parentId,
  activeChildKind,
}: {
  block: Block;
  parentId: string;
  activeChildKind: BlockKind | null;
}) {
  const { dispatch } = useProject();
  const def = BLOCKS[block.kind];
  const Icon = BLOCK_ICONS[block.kind];
  const [collapsed, setCollapsed] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: block.id,
      data: { type: "sub", id: block.id, parentId, kind: block.kind },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 40 : undefined,
    "--block-color": def.color,
  } as React.CSSProperties;

  const isGroup = def.role === "group";
  // A text leaf can stretch to fill a parent block whose height the user has
  // pulled taller — the flex chain below carries that growth down to the textarea.
  const isTextLeaf = !isGroup && def.valueType === "text";
  const accepts = activeChildKind ? canAdd(block, activeChildKind) : false;
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`blk relative ${isTextLeaf ? "flex min-h-0 flex-1 flex-col" : ""}`}
    >
      <div
        className={`blk-shadow-sm overflow-hidden rounded-lg border border-black/10 ${
          accepts ? "ring-2 ring-accent ring-offset-1" : ""
        } ${isTextLeaf ? "flex min-h-0 flex-1 flex-col" : ""}`}
      >
        {/* Header — drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="blk-header flex cursor-grab touch-none items-center gap-1.5 px-2 py-1.5 active:cursor-grabbing"
        >
          <GripVertical className="size-3 shrink-0 text-white/40" />
          <Icon className="size-3 shrink-0 text-white/90" />
          <span className="min-w-0 shrink truncate text-[11px] font-bold uppercase tracking-wide">
            {def.label}
          </span>
          {isGroup && (
            <span className="shrink-0" onPointerDown={stop}>
              <HelpPopover kind={block.kind} />
            </span>
          )}
          {def.hasName && !collapsed && (
            <input
              value={block.name ?? ""}
              onChange={(e) =>
                dispatch({ type: "renameBlock", id: block.id, name: e.target.value })
              }
              onPointerDown={stop}
              placeholder="name it"
              className="min-w-0 flex-1 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-xs font-semibold text-white placeholder-white/50 outline-none focus:border-white/50 focus:bg-white/20"
            />
          )}
          {collapsed && (
            <span className="ml-1 min-w-0 flex-1 truncate text-[11px] font-normal text-white/70">
              {block.name?.trim() || previewOf(block)}
            </span>
          )}
          <button
            onPointerDown={stop}
            onClick={() => setCollapsed((c) => !c)}
            className="ml-auto shrink-0 rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronRight className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </button>
          <button
            onPointerDown={stop}
            onClick={() => dispatch({ type: "removeBlock", id: block.id })}
            className="shrink-0 rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
            aria-label={`Remove ${def.label}`}
          >
            <Trash2 className="size-3" />
          </button>
        </div>

        {!collapsed &&
          (isGroup ? (
            <GroupBody block={block} activeChildKind={activeChildKind} accepts={accepts} />
          ) : (
            <div
              className={`blk-body px-2 py-2 ${
                isTextLeaf ? "flex min-h-0 flex-1 flex-col" : ""
              }`}
            >
              <FieldEditor block={block} />
            </div>
          ))}
      </div>
    </div>
  );
}

function GroupBody({
  block,
  activeChildKind,
  accepts,
}: {
  block: Block;
  activeChildKind: BlockKind | null;
  accepts: boolean;
}) {
  const { kids } = useKidsMode();
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${block.id}`,
    data: { type: "container", blockId: block.id },
  });

  return (
    <>
      <div className="flex">
        {/* Left arm of the C */}
        <div className="blk-arm w-2 shrink-0" />
        {/* Mouth — where child blocks live */}
        <div ref={setNodeRef} className="blk-body flex min-w-0 flex-1 flex-col gap-2 px-2 py-2">
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
            className={`rounded-md border border-dashed px-2 py-1.5 text-center text-[11px] font-medium transition-colors ${
              accepts || isOver
                ? "border-accent bg-accent/10 text-accent"
                : "border-black/15 text-foreground/40"
            }`}
          >
            {kids ? "Snap blocks here" : "Drag blocks here"}
          </div>
        </div>
      </div>
      {/* Bottom cap of the C */}
      <div className="blk-header h-2" />
    </>
  );
}
