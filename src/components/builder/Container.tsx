"use client";

// A C-shaped container block placed on the canvas. Freely positioned, dragged
// to move by its header grip, and a drop target for typed sub-blocks.

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  CONTAINERS,
  hasSub,
  isAllowed,
  type ContainerInstance,
  type SubKind,
} from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { SubBlockCard } from "./SubBlockCard";

export function Container({
  instance,
  activeSubKind,
}: {
  instance: ContainerInstance;
  activeSubKind: SubKind | null;
}) {
  const { dispatch } = useProject();
  const def = CONTAINERS[instance.kind];
  const pal = def.palette;

  // Drag-to-move (handle = header grip).
  const {
    setNodeRef: setMoveRef,
    listeners,
    attributes,
    transform,
    isDragging,
  } = useDraggable({
    id: `move:${instance.id}`,
    data: { type: "move", id: instance.id },
  });

  // Drop target for sub-blocks.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${instance.id}`,
    data: { type: "container", containerId: instance.id, kind: instance.kind },
  });

  const accepts =
    activeSubKind !== null &&
    isAllowed(activeSubKind, instance.kind) &&
    !hasSub(instance, activeSubKind);
  const rejects = activeSubKind !== null && !accepts;

  const style: React.CSSProperties = {
    left: instance.x,
    top: instance.y,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 50 : undefined,
    width: 340,
  };

  return (
    <div
      ref={setMoveRef}
      style={style}
      onPointerDown={() => dispatch({ type: "bringToFront", id: instance.id })}
      className={`absolute select-none rounded-2xl border shadow-[0_8px_24px_-12px_rgba(60,40,20,0.35)] transition-shadow ${
        accepts ? "ring-4 ring-accent/50" : ""
      } ${rejects ? "opacity-40" : ""}`}
    >
      {/* Header (top of the C) — the grip */}
      <div
        {...listeners}
        {...attributes}
        style={{ backgroundColor: pal.base, color: pal.on }}
        className="flex cursor-grab touch-none items-center gap-2 rounded-t-2xl px-3 py-2 active:cursor-grabbing"
      >
        <span className="text-lg" aria-hidden>
          {def.icon}
        </span>
        {def.hasName ? (
          <input
            value={instance.name ?? ""}
            onChange={(e) =>
              dispatch({
                type: "renameContainer",
                id: instance.id,
                name: e.target.value,
              })
            }
            onPointerDown={(e) => e.stopPropagation()}
            placeholder={`Name this ${def.label.toLowerCase()}`}
            className="min-w-0 flex-1 rounded-md bg-white/20 px-2 py-0.5 font-display text-base font-semibold placeholder-white/70 outline-none focus:bg-white/30"
          />
        ) : (
          <span className="font-display text-base font-semibold">{def.label}</span>
        )}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => dispatch({ type: "removeContainer", id: instance.id })}
          className="ml-auto rounded-full px-1.5 text-white/80 hover:bg-white/20 hover:text-white"
          aria-label={`Remove this ${def.label}`}
          title="Remove"
        >
          ✕
        </button>
      </div>

      {/* Body (inside of the C) */}
      <div
        ref={setDropRef}
        style={{ backgroundColor: pal.soft, borderColor: pal.base }}
        className="space-y-2 rounded-b-2xl border-x-4 border-b-4 px-3 py-3"
      >
        <SortableContext
          items={instance.subBlocks.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          {instance.subBlocks.map((block) => (
            <SubBlockCard key={block.id} containerId={instance.id} block={block} />
          ))}
        </SortableContext>

        {instance.subBlocks.length === 0 && (
          <div
            className={`rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs font-semibold ${
              accepts || isOver
                ? "border-foreground/40 text-foreground/70"
                : "border-foreground/15 text-foreground/40"
            }`}
          >
            Drag a {def.label} block here
          </div>
        )}
      </div>
    </div>
  );
}
