"use client";

// The editor: palette on the left, blank canvas on the right, wired through one
// DndContext. Dragging a container block onto the canvas places it; dragging a
// sub-block into a container snaps it in; dragging a placed container moves it.

import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  CONTAINERS,
  SUB_BLOCKS,
  isAllowed,
  type ContainerKind,
  type SubKind,
} from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { Palette } from "./Palette";
import { Canvas } from "./Canvas";

type ActiveDrag =
  | { type: "palette-container"; kind: ContainerKind }
  | { type: "palette-sub"; subKind: SubKind }
  | { type: "sub"; subId: string; subKind: SubKind; containerId: string }
  | { type: "move"; id: string }
  | null;

export function Builder() {
  const { doc, dispatch } = useProject();
  const [active, setActive] = useState<ActiveDrag>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // Last pointer position, tracked while dragging, so palette drops land where
  // the cursor is (dnd-kit doesn't hand us pointer coords on drop).
  const pointer = useRef({ x: 0, y: 0 });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function trackPointer(e: PointerEvent) {
    pointer.current = { x: e.clientX, y: e.clientY };
  }

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current;
    if (!data) return;
    window.addEventListener("pointermove", trackPointer);
    if (data.type === "palette-container") {
      setActive({ type: "palette-container", kind: data.kind });
    } else if (data.type === "palette-sub") {
      setActive({ type: "palette-sub", subKind: data.subKind });
    } else if (data.type === "sub") {
      setActive({
        type: "sub",
        subId: data.subId,
        subKind: data.subKind,
        containerId: data.containerId,
      });
    } else if (data.type === "move") {
      setActive({ type: "move", id: data.id });
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const a = active;
    setActive(null);
    window.removeEventListener("pointermove", trackPointer);
    if (!a) return;

    const overData = e.over?.data.current;

    // 1) Place a new container at the pointer location on the canvas.
    if (a.type === "palette-container") {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const inside =
        pointer.current.x >= rect.left &&
        pointer.current.x <= rect.right &&
        pointer.current.y >= rect.top &&
        pointer.current.y <= rect.bottom;
      if (!inside) return;
      const x =
        pointer.current.x - rect.left + (canvasRef.current?.scrollLeft ?? 0) - 24;
      const y =
        pointer.current.y - rect.top + (canvasRef.current?.scrollTop ?? 0) - 16;
      dispatch({
        type: "placeContainer",
        kind: a.kind,
        x: Math.max(0, x),
        y: Math.max(0, y),
      });
      return;
    }

    // 2) Snap a new sub-block into a container.
    if (a.type === "palette-sub") {
      const target = resolveContainer(overData);
      if (target && isAllowed(a.subKind, target.kind)) {
        dispatch({
          type: "addSubBlock",
          containerId: target.containerId,
          subKind: a.subKind,
        });
      }
      return;
    }

    // 3) Reorder a sub-block within its container.
    if (a.type === "sub" && overData?.type === "sub") {
      if (
        overData.containerId === a.containerId &&
        overData.subId !== a.subId
      ) {
        dispatch({
          type: "reorderSub",
          containerId: a.containerId,
          fromId: a.subId,
          toId: overData.subId,
        });
      }
      return;
    }

    // 4) Move a placed container by the drag delta.
    if (a.type === "move") {
      const block = doc.blocks.find((b) => b.id === a.id);
      if (block) {
        dispatch({
          type: "moveContainer",
          id: a.id,
          x: Math.max(0, block.x + e.delta.x),
          y: Math.max(0, block.y + e.delta.y),
        });
      }
    }
  }

  const activeSubKind =
    active?.type === "palette-sub" ? active.subKind : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        window.removeEventListener("pointermove", trackPointer);
      }}
    >
      <div className="flex h-full min-h-0">
        <Palette />
        <Canvas activeSubKind={activeSubKind} canvasRef={canvasRef} />
      </div>

      <DragOverlay dropAnimation={null}>
        {active?.type === "palette-container" && (
          <ContainerGhost kind={active.kind} />
        )}
        {(active?.type === "palette-sub" || active?.type === "sub") && (
          <SubGhost subKind={active.subKind} />
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Resolve which container a drop landed in (container body or a sub-block). */
function resolveContainer(
  overData: Record<string, unknown> | undefined,
): { containerId: string; kind: ContainerKind } | null {
  if (!overData) return null;
  if (overData.type === "container") {
    return {
      containerId: overData.containerId as string,
      kind: overData.kind as ContainerKind,
    };
  }
  if (overData.type === "sub") {
    // The sub-block's container kind is implied by the sub-block kind.
    const kind = SUB_BLOCKS[overData.subKind as SubKind].container;
    return { containerId: overData.containerId as string, kind };
  }
  return null;
}

function ContainerGhost({ kind }: { kind: ContainerKind }) {
  const def = CONTAINERS[kind];
  return (
    <div
      style={{ backgroundColor: def.palette.base, color: def.palette.on }}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 font-display text-sm font-semibold shadow-lg"
    >
      <span aria-hidden>{def.icon}</span>
      {def.label}
    </div>
  );
}

function SubGhost({ subKind }: { subKind: SubKind }) {
  const def = SUB_BLOCKS[subKind];
  const pal = CONTAINERS[def.container].palette;
  return (
    <div
      style={{ backgroundColor: pal.base, color: pal.on }}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold shadow-lg"
    >
      <span aria-hidden>{def.icon}</span>
      {def.label}
    </div>
  );
}
