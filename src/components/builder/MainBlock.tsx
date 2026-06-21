"use client";

// A top-level main block on the canvas — a C-block frame (coloured header, left
// arm, light mouth, bottom cap) that holds child blocks. Freely positioned,
// dragged by its header, a drop target for children, and collapsible.

import { useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { BLOCKS, canAdd, type Block, type BlockKind } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { BlockNode } from "./BlockNode";
import { HelpPopover } from "./HelpPopover";
import { previewOf } from "./preview";
import { ChevronIcon, CloseIcon, GripIcon } from "./icons";

export function MainBlock({
  block,
  activeChildKind,
  following,
  onResize,
  connected,
}: {
  block: Block;
  activeChildKind: BlockKind | null;
  /** When this block is snapped below the one being dragged, the live delta. */
  following: { x: number; y: number } | null;
  /** Called when this block's height changes, so connected blocks below reflow. */
  onResize: (id: string) => void;
  /** Snapped beneath another block — show a subtle seam highlight at the top. */
  connected: boolean;
}) {
  const { dispatch } = useProject();
  const { kids } = useKidsMode();
  const def = BLOCKS[block.kind];
  const [collapsed, setCollapsed] = useState(false);

  // Reflow blocks snapped below this one whenever its height changes (collapse /
  // expand, adding sub-blocks) so the connected stack stays tight.
  const elRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      onResize(block.id);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [block.id, onResize]);

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
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  // Head of a drag uses dnd-kit's transform; blocks snapped below it follow the
  // live delta so the connected stack moves as one.
  const t = following ?? transform;
  const style: React.CSSProperties = {
    left: block.x ?? 0,
    top: block.y ?? 0,
    transform: t ? `translate3d(${t.x}px, ${t.y}px, 0)` : undefined,
    zIndex: isDragging || following ? 50 : undefined,
    width: 340,
    "--block-color": def.color,
  } as React.CSSProperties;

  return (
    <div
      ref={(el) => {
        elRef.current = el;
        setMoveRef(el);
      }}
      data-block-id={block.id}
      style={style}
      className="blk absolute select-none"
    >
      {/* Seam highlight where this block connects to the one above it. */}
      {connected && (
        <div className="pointer-events-none absolute inset-x-3 -top-0.5 z-10 h-1 rounded-full bg-accent/60 shadow-[0_0_6px_1px_rgba(190,90,46,0.45)]" />
      )}

      <div
        className={`blk-shadow overflow-hidden rounded-lg border border-black/10 ${
          accepts ? "ring-2 ring-accent ring-offset-1" : ""
        }`}
      >
        {/* Header — drag handle */}
        <div
          {...listeners}
          {...attributes}
          className="blk-header flex cursor-grab touch-none items-center gap-1.5 px-2.5 py-1.5 active:cursor-grabbing"
        >
          <GripIcon className="h-4 w-4 shrink-0 text-white/40" />
          <span className="shrink-0 font-display text-xs font-bold uppercase tracking-wider">
            {def.label}
          </span>
          <span className="shrink-0" onPointerDown={stop}>
            <HelpPopover kind={block.kind} />
          </span>
          {def.hasName && !collapsed && (
            <input
              value={block.name ?? ""}
              onChange={(e) =>
                dispatch({ type: "renameBlock", id: block.id, name: e.target.value })
              }
              onPointerDown={stop}
              placeholder="name it"
              className="min-w-0 flex-1 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-display text-sm font-semibold text-white placeholder-white/50 outline-none focus:border-white/50 focus:bg-white/20"
            />
          )}
          {collapsed && (
            <span className="ml-1 min-w-0 flex-1 truncate text-xs font-normal text-white/70">
              {block.name?.trim() || previewOf(block)}
            </span>
          )}
          <button
            onPointerDown={stop}
            onClick={() => setCollapsed((c) => !c)}
            className="ml-auto shrink-0 rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            <ChevronIcon className="h-4 w-4" open={!collapsed} />
          </button>
          <button
            onPointerDown={stop}
            onClick={() => dispatch({ type: "removeBlock", id: block.id })}
            className="shrink-0 rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
            aria-label={`Remove ${def.label}`}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {!collapsed && (
          <>
            <div className="flex">
              {/* Left arm */}
              <div className="blk-arm w-2.5 shrink-0" />
              {/* Mouth */}
              <div ref={setDropRef} className="blk-body flex-1 space-y-2 px-2.5 py-2.5">
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
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-black/15 text-foreground/40"
                  }`}
                >
                  {kids ? "Snap blocks here" : "Drag blocks here"}
                </div>
              </div>
            </div>
            {/* Bottom cap */}
            <div className="blk-header h-2.5" />
          </>
        )}
      </div>
    </div>
  );
}
