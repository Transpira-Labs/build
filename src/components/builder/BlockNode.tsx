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
import { ChevronIcon, CloseIcon, GripIcon } from "./icons";

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
  const accepts = activeChildKind ? canAdd(block, activeChildKind) : false;
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div ref={setNodeRef} style={style} className="blk relative">
      <div
        className={`blk-shadow overflow-hidden rounded-md border border-black/10 ${
          accepts ? "ring-2 ring-accent ring-offset-1" : ""
        }`}
      >
        {/* Header — drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="blk-header flex cursor-grab touch-none items-center gap-1.5 px-2 py-1 active:cursor-grabbing"
        >
          <GripIcon className="h-3.5 w-3.5 shrink-0 text-white/40" />
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
            <ChevronIcon className="h-3.5 w-3.5" open={!collapsed} />
          </button>
          <button
            onPointerDown={stop}
            onClick={() => dispatch({ type: "removeBlock", id: block.id })}
            className="shrink-0 rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
            aria-label={`Remove ${def.label}`}
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        {!collapsed &&
          (isGroup ? (
            <GroupBody block={block} activeChildKind={activeChildKind} accepts={accepts} />
          ) : (
            <div className="blk-body px-2 py-2">
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
        <div ref={setNodeRef} className="blk-body flex-1 space-y-2 px-2 py-2">
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
