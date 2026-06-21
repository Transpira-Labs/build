"use client";

// The editor: palette on the left, blank canvas on the right, wired through one
// DndContext. Dragging a main block onto the canvas places it; dragging a detail
// block into a container snaps it into the nearest accepting block (which may be
// nested); dragging a placed block reorders or moves it.

import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  BLOCKS,
  nearestAccepting,
  type BlockKind,
  type MainKind,
} from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { Palette } from "./Palette";
import { Canvas } from "./Canvas";

type ActiveDrag =
  | { type: "palette-main"; kind: MainKind }
  | { type: "palette-sub"; kind: BlockKind; from: MainKind }
  | { type: "sub"; id: string; kind: BlockKind; parentId: string }
  | { type: "move"; id: string }
  | null;

export function Builder() {
  const { doc, dispatch } = useProject();
  const [active, setActive] = useState<ActiveDrag>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // When adding from the palette, target the innermost container under the
  // pointer; reordering and moving use closest-center.
  const collision: CollisionDetection = (args) => {
    const type = args.active.data.current?.type;
    if (type === "palette-sub") {
      const hits = pointerWithin(args).filter((h) =>
        String(h.id).startsWith("drop:"),
      );
      if (hits.length <= 1) return hits;
      const area = (id: string | number) => {
        const r = args.droppableRects.get(id);
        return r ? r.width * r.height : Infinity;
      };
      return [...hits].sort((a, b) => area(a.id) - area(b.id)).slice(0, 1);
    }
    if (type === "palette-main") {
      return pointerWithin(args).filter((h) => h.id === "canvas");
    }
    return closestCenter(args);
  };

  function trackPointer(e: PointerEvent) {
    pointer.current = { x: e.clientX, y: e.clientY };
  }

  // The drop point in canvas coordinates, or null if the pointer is off-canvas.
  function canvasPoint() {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const inside =
      pointer.current.x >= rect.left &&
      pointer.current.x <= rect.right &&
      pointer.current.y >= rect.top &&
      pointer.current.y <= rect.bottom;
    if (!inside) return null;
    return {
      x: Math.max(0, pointer.current.x - rect.left + (canvasRef.current?.scrollLeft ?? 0) - 24),
      y: Math.max(0, pointer.current.y - rect.top + (canvasRef.current?.scrollTop ?? 0) - 16),
    };
  }

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current;
    if (!data) return;
    window.addEventListener("pointermove", trackPointer);
    if (data.type === "palette-main") setActive({ type: "palette-main", kind: data.kind });
    else if (data.type === "palette-sub")
      setActive({ type: "palette-sub", kind: data.kind, from: data.from });
    else if (data.type === "sub")
      setActive({ type: "sub", id: data.id, kind: data.kind, parentId: data.parentId });
    else if (data.type === "move") setActive({ type: "move", id: data.id });
  }

  function onDragEnd(e: DragEndEvent) {
    const a = active;
    setActive(null);
    window.removeEventListener("pointermove", trackPointer);
    if (!a) return;
    const overData = e.over?.data.current;

    // 1) Place a new main block at the pointer.
    if (a.type === "palette-main") {
      const pt = canvasPoint();
      if (!pt) return;
      dispatch({ type: "placeMain", kind: a.kind, x: pt.x, y: pt.y });
      return;
    }

    // 2) Snap a detail block into the nearest accepting block. If it was dropped
    //    without an accepting home, auto-spawn the main block it belongs to so
    //    the user doesn't have to place the big block first.
    if (a.type === "palette-sub") {
      const containerId = overData?.blockId as string | undefined;
      const targetId = containerId
        ? nearestAccepting(doc.blocks, containerId, a.kind)
        : null;
      if (targetId) {
        dispatch({ type: "addChild", parentId: targetId, kind: a.kind });
        return;
      }
      const pt = canvasPoint();
      if (pt) {
        dispatch({
          type: "placeChildInNewMain",
          mainKind: a.from,
          childKind: a.kind,
          x: pt.x,
          y: pt.y,
        });
      }
      return;
    }

    // 3) Reorder a block within its current parent.
    if (a.type === "sub" && overData?.type === "sub") {
      if (overData.parentId === a.parentId && overData.id !== a.id) {
        dispatch({
          type: "reorder",
          parentId: a.parentId,
          fromId: a.id,
          toId: overData.id as string,
        });
      }
      return;
    }

    // 4) Move a placed main block.
    if (a.type === "move") {
      const block = doc.blocks.find((b) => b.id === a.id);
      if (block) {
        dispatch({
          type: "moveMain",
          id: a.id,
          x: Math.max(0, (block.x ?? 0) + e.delta.x),
          y: Math.max(0, (block.y ?? 0) + e.delta.y),
        });
      }
    }
  }

  const activeChildKind =
    active?.type === "palette-sub" ? active.kind : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        window.removeEventListener("pointermove", trackPointer);
      }}
    >
      <div className="flex h-full min-h-0">
        <Palette />
        <Canvas activeChildKind={activeChildKind} canvasRef={canvasRef} />
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (active.type === "palette-main" || active.type === "palette-sub" || active.type === "sub") && (
          <Ghost kind={active.kind} />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Ghost({ kind }: { kind: BlockKind }) {
  const def = BLOCKS[kind];
  const main = def.role === "main";
  return (
    <div
      style={{ borderLeftColor: main ? undefined : def.color, borderTopColor: main ? def.color : undefined }}
      className={`rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-lg ${
        main ? "border-t-[3px] font-display font-semibold" : "border-l-2"
      }`}
    >
      {def.label}
    </div>
  );
}
