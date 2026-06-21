"use client";

// The editor: palette on the left, blank canvas on the right, wired through one
// DndContext. Dragging a main block onto the canvas places it; dragging a detail
// block into a container snaps it into the nearest accepting block (which may be
// nested); dragging a placed block reorders or moves it.

import { useCallback, useEffect, useRef, useState } from "react";
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
  type DragMoveEvent,
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
import { Canvas, type View } from "./Canvas";

type ActiveDrag =
  | { type: "palette-main"; kind: MainKind }
  | { type: "palette-sub"; kind: BlockKind; from: MainKind }
  | { type: "sub"; id: string; kind: BlockKind; parentId: string }
  | { type: "move"; id: string }
  | null;

// Snap thresholds for connecting main blocks (px).
const HSNAP = 30;
const VSNAP = 22;

export function Builder() {
  const { doc, dispatch } = useProject();
  const [active, setActive] = useState<ActiveDrag>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  // Connection links live in the doc (childId -> parentId snapped beneath) so
  // they persist across reloads/saves. docRef gives callbacks the latest doc
  // (incl. connections) without re-subscribing.
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  });

  // Dragging state for the connected chain (head + blocks snapped below).
  const chainRef = useRef<string[]>([]);
  const [followers, setFollowers] = useState<string[]>([]);
  const [followDelta, setFollowDelta] = useState({ x: 0, y: 0 });

  // Canvas pan/zoom.
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Measured height of a placed main block (varies with content/collapse).
  const heightOf = (id: string) =>
    (canvasRef.current?.querySelector(`[data-block-id="${id}"]`) as HTMLElement | null)
      ?.offsetHeight ?? 0;

  // `headId` + everything connected beneath it (a linear chain).
  const computeChain = (headId: string): string[] => {
    const conn = docRef.current.connections ?? {};
    const chain = [headId];
    let cur = headId;
    while (chain.length < docRef.current.blocks.length) {
      const child = Object.keys(conn).find(
        (c) => conn[c] === cur && !chain.includes(c),
      );
      if (!child) break;
      chain.push(child);
      cur = child;
    }
    return chain;
  };

  // Re-stack the blocks connected below `id` so a height change (expand/collapse,
  // adding sub-blocks) never leaves them overlapping or gapped.
  const reflow = useCallback((id: string) => {
    const blocks = docRef.current.blocks;
    const conn = docRef.current.connections ?? {};
    const byId = (bid: string) => blocks.find((b) => b.id === bid);
    let cur = byId(id);
    if (!cur) return;
    const curX = cur.x ?? 0;
    let curY = cur.y ?? 0;
    const moves: { id: string; x: number; y: number }[] = [];
    const seen = new Set([id]);
    while (cur) {
      const childId = Object.keys(conn).find(
        (c) => conn[c] === cur!.id && !seen.has(c),
      );
      const child = childId ? byId(childId) : undefined;
      if (!child) break;
      const ny = curY + heightOf(cur.id);
      if ((child.y ?? 0) !== ny || (child.x ?? 0) !== curX) {
        moves.push({ id: child.id, x: curX, y: ny });
      }
      seen.add(child.id);
      cur = child;
      curY = ny; // curX unchanged — the stack shares one left edge
    }
    if (moves.length) dispatch({ type: "moveMany", moves });
  }, [dispatch]);

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
    // Screen → content coordinates (undo the canvas pan/zoom transform). No
    // lower clamp — blocks can live anywhere on the (pannable) infinite canvas.
    return {
      x: (pointer.current.x - rect.left - view.x) / view.scale - 24,
      y: (pointer.current.y - rect.top - view.y) / view.scale - 16,
    };
  }

  // Click-to-create from the palette: drop the block near the centre of the
  // current viewport (singletons are already disabled in the palette).
  function placeMainAtCenter(kind: MainKind) {
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? (rect.width / 2 - view.x) / view.scale : 220;
    const cy = rect ? (rect.height / 2 - view.y) / view.scale : 180;
    dispatch({
      type: "placeMain",
      kind,
      x: cx - 170,
      y: cy - 140,
    });
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
    else if (data.type === "move") {
      setActive({ type: "move", id: data.id });
      const chain = computeChain(data.id);
      chainRef.current = chain;
      setFollowers(chain.slice(1)); // everything below the head moves with it
      setFollowDelta({ x: 0, y: 0 });
    }
  }

  function onDragMove(e: DragMoveEvent) {
    if (chainRef.current.length > 1) setFollowDelta({ x: e.delta.x, y: e.delta.y });
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

    // 4) Move a placed main block — plus any blocks snapped below it — and snap
    //    the head under a nearby block so they "click together".
    if (a.type === "move") {
      const chain = chainRef.current.length ? chainRef.current : [a.id];
      chainRef.current = [];
      setFollowers([]);
      setFollowDelta({ x: 0, y: 0 });

      const head = doc.blocks.find((b) => b.id === a.id);
      if (!head) return;

      let nx = (head.x ?? 0) + e.delta.x / view.scale;
      let ny = (head.y ?? 0) + e.delta.y / view.scale;

      // Snap the head under a nearby (non-chain) block. Forgiving on height: drop
      // the head's top anywhere over the target's lower half — or just below it —
      // and it clicks under the target. (A tight bottom-edge test only worked for
      // short/collapsed blocks; tall expanded blocks were impossible to hit.)
      let best: { id: string; d: number } | null = null;
      for (const t of doc.blocks) {
        if (chain.includes(t.id)) continue;
        const ty = t.y ?? 0;
        const th = heightOf(t.id);
        const xAligned = Math.abs(nx - (t.x ?? 0)) < HSNAP;
        const inZone = ny >= ty + th * 0.4 && ny <= ty + th + VSNAP;
        if (xAligned && inZone) {
          const d = Math.abs(ny - (ty + th));
          if (!best || d < best.d) best = { id: t.id, d };
        }
      }

      // Head disconnects from any previous parent; reconnect only if it snapped.
      const conn = doc.connections ?? {};
      let newParent: string | null = null;
      if (best) {
        // Append to the bottom of the target's existing stack. Only follow
        // links to blocks that still exist on the canvas — a stale connection
        // (e.g. left over from a removed/migrated block) must not derail the
        // walk into a non-existent id.
        let parentId = best.id;
        for (let i = 0; i < doc.blocks.length; i++) {
          const child = Object.keys(conn).find(
            (c) =>
              conn[c] === parentId &&
              !chain.includes(c) &&
              doc.blocks.some((b) => b.id === c),
          );
          if (!child) break;
          parentId = child;
        }
        const p = doc.blocks.find((b) => b.id === parentId);
        if (p) {
          nx = p.x ?? 0;
          ny = (p.y ?? 0) + heightOf(parentId);
          newParent = parentId;
        }
      }

      const dx = nx - (head.x ?? 0);
      const dy = ny - (head.y ?? 0);
      const moves = chain
        .map((id) => doc.blocks.find((b) => b.id === id))
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => ({
          id: b.id,
          x: (b.x ?? 0) + dx,
          y: (b.y ?? 0) + dy,
        }));
      dispatch({ type: "moveMany", moves });
      dispatch({ type: "connect", childId: a.id, parentId: newParent });
      dispatch({ type: "bringToFront", id: a.id });
    }
  }

  const activeChildKind =
    active?.type === "palette-sub" ? active.kind : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      // Auto-scroll inflates the drop delta on the overflow-auto canvas (a block
      // dragged down grows the scroll area, dnd-kit scrolls, and that scroll is
      // added into delta.y) — which made blocks jump down on release.
      autoScroll={false}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        chainRef.current = [];
        setFollowers([]);
        setFollowDelta({ x: 0, y: 0 });
        window.removeEventListener("pointermove", trackPointer);
      }}
    >
      <div className="flex h-full min-h-0 flex-1">
        <Palette onCreate={placeMainAtCenter} />
        <Canvas
          activeChildKind={activeChildKind}
          canvasRef={canvasRef}
          followers={followers}
          followDelta={followDelta}
          onResize={reflow}
          view={view}
          setView={setView}
        />
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
  return (
    <div
      style={{ "--block-color": def.color } as React.CSSProperties}
      className="blk blk-shadow blk-header rounded-md px-3 py-1.5 text-sm font-bold text-white"
    >
      {def.label}
    </div>
  );
}
