"use client";

// A top-level main block on the canvas — a C-block frame (coloured header, left
// arm, light mouth, bottom cap) that holds child blocks. Freely positioned,
// dragged by its header, a drop target for children, and collapsible.

import { useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  BLOCKS,
  canAdd,
  MAIN_WIDTH,
  MAIN_WIDTH_MAX,
  MAIN_WIDTH_MIN,
  type Block,
  type BlockKind,
} from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { BlockNode } from "./BlockNode";
import { HelpPopover } from "./HelpPopover";
import { previewOf } from "./preview";
import { BLOCK_ICONS } from "./blockIcons";
import { ChevronDown, ChevronRight, GripVertical, Trash2 } from "lucide-react";

export function MainBlock({
  block,
  activeChildKind,
  following,
  onResize,
  scale = 1,
}: {
  block: Block;
  activeChildKind: BlockKind | null;
  /** When this block is snapped below the one being dragged, the live delta. */
  following: { x: number; y: number } | null;
  /** Called when this block's height changes, so connected blocks below reflow. */
  onResize: (id: string) => void;
  /** Canvas zoom — drag transforms are divided by it (block lives in a scaled layer). */
  scale?: number;
}) {
  const { dispatch } = useProject();
  const { kids } = useKidsMode();
  const def = BLOCKS[block.kind];
  const Icon = BLOCK_ICONS[block.kind];
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

  // Right-edge width handle: drag to set this block's width (persisted per block).
  // Deltas are divided by the canvas zoom since the block lives in a scaled layer.
  const widthDrag = useRef<{ startX: number; startW: number } | null>(null);
  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    widthDrag.current = { startX: e.clientX, startW: block.width ?? MAIN_WIDTH };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const r = widthDrag.current;
    if (!r) return;
    const dx = (e.clientX - r.startX) / scale;
    const w = Math.round(
      Math.min(MAIN_WIDTH_MAX, Math.max(MAIN_WIDTH_MIN, r.startW + dx)),
    );
    dispatch({ type: "setWidth", id: block.id, width: w });
  };
  const onHandleUp = (e: React.PointerEvent) => {
    widthDrag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }
  };

  // Head of a drag uses dnd-kit's transform; blocks snapped below it follow the
  // live delta so the connected stack moves as one.
  const t = following ?? transform;
  const style: React.CSSProperties = {
    left: block.x ?? 0,
    top: block.y ?? 0,
    transform: t
      ? `translate3d(${t.x / scale}px, ${t.y / scale}px, 0)`
      : undefined,
    zIndex: isDragging || following ? 50 : undefined,
    width: block.width ?? MAIN_WIDTH,
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
      className="blk group absolute select-none pt-[10px]"
    >
      {/* Top socket — the peg of the block above drops into it. */}
      <div className="blk-socket" />

      {/* Right-edge width handle (hover to reveal). */}
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        title="Drag to resize width"
        className="absolute bottom-0 right-0 top-[10px] z-10 flex w-2.5 cursor-ew-resize items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
      >
        <span className="h-10 w-1 rounded-full bg-black/25" />
      </div>

      <div
        className={`blk-shadow overflow-hidden rounded-2xl border border-black/10 ${
          accepts ? "ring-2 ring-accent ring-offset-1" : ""
        }`}
      >
        {/* Header — drag handle */}
        <div
          {...listeners}
          {...attributes}
          className="blk-header flex cursor-grab touch-none items-center gap-1.5 px-2.5 py-2 active:cursor-grabbing"
        >
          <GripVertical className="size-3.5 shrink-0 text-white/40" />
          <Icon className="size-3.5 shrink-0 text-white/90" />
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
            {collapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
          <button
            onPointerDown={stop}
            onClick={() => dispatch({ type: "removeBlock", id: block.id })}
            className="shrink-0 rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white"
            aria-label={`Remove ${def.label}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        {!collapsed && (
          <>
            <div className="flex">
              {/* Left arm */}
              <div className="blk-arm w-2.5 shrink-0" />
              {/* Mouth */}
              <div ref={setDropRef} className="blk-body min-w-0 flex-1 space-y-2 px-2.5 py-2.5">
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

      {/* Bottom peg — drops into the socket of the block below. */}
      <div className="blk-peg" />
    </div>
  );
}
