"use client";

// The workspace: a pan/zoom viewport (dual line-grid) holding a transformed
// content layer where the main blocks live at absolute positions.

import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { LayoutGrid, List, Maximize2, Shrink } from "lucide-react";
import type { BlockKind } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { MainBlock } from "./MainBlock";
import { BlockList } from "./BlockList";

export type View = { x: number; y: number; scale: number };

export function Canvas({
  activeChildKind,
  canvasRef,
  followers,
  followDelta,
  onResize,
  view,
  setView,
}: {
  activeChildKind: BlockKind | null;
  canvasRef: RefObject<HTMLDivElement | null>;
  followers: string[];
  followDelta: { x: number; y: number };
  onResize: (id: string) => void;
  view: View;
  setView: (fn: (v: View) => View) => void;
}) {
  const { doc, dispatch } = useProject();
  const { setNodeRef } = useDroppable({ id: "canvas" });
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  // Wheel/trackpad gestures. A trackpad pinch arrives as a wheel event with
  // ctrlKey set — that zooms toward the cursor. A plain scroll pans (it never
  // zooms, so it can't be triggered accidentally; the slider is the other way in).
  // Non-passive so we can preventDefault and stop the page from scrolling.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        setView((v) => {
          // deltaY is the pinch magnitude; scale it gently for smooth zooming.
          const factor = Math.exp(-e.deltaY * 0.01);
          const scale = Math.min(2.5, Math.max(0.3, v.scale * factor));
          const k = scale / v.scale;
          return { scale, x: mx - k * (mx - v.x), y: my - k * (my - v.y) };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [canvasRef, setView]);

  // Drag the empty background to pan.
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-block-id]")) return;
    pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    setGrabbing(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    setView((v) => ({ ...v, x: p.vx + (e.clientX - p.sx), y: p.vy + (e.clientY - p.sy) }));
  };
  const endPan = () => {
    pan.current = null;
    setGrabbing(false);
  };

  // Recenter the viewport on every placed block (the bounding box of the whole
  // canvas), scaling to fit with a margin. Rescues blocks dragged off-screen.
  const fitToBlocks = useCallback(() => {
    const el = canvasRef.current;
    if (!el || doc.blocks.length === 0) {
      setView(() => ({ x: 0, y: 0, scale: 1 }));
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of doc.blocks) {
      const node = el.querySelector(
        `[data-block-id="${b.id}"]`,
      ) as HTMLElement | null;
      // offsetWidth/Height are unscaled layout sizes — content coordinates.
      const w = node?.offsetWidth ?? 340;
      const h = node?.offsetHeight ?? 160;
      const x = b.x ?? 0;
      const y = b.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }

    const rect = el.getBoundingClientRect();
    const pad = 80;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = Math.min(
      2.5,
      Math.max(0.3, Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh)),
    );
    // Map the block-box center to the viewport center: screen = view + content*scale.
    const x = rect.width / 2 - (minX + bw / 2) * scale;
    const y = rect.height / 2 - (minY + bh / 2) * scale;
    setView(() => ({ x, y, scale }));
  }, [canvasRef, doc.blocks, setView]);

  // Fly the viewport to a single block, centring it without changing zoom. Used
  // by the list view to jump to a block on a crowded canvas.
  const focusBlock = useCallback(
    (id: string) => {
      const el = canvasRef.current;
      const b = doc.blocks.find((bl) => bl.id === id);
      if (!el || !b) return;
      const node = el.querySelector(
        `[data-block-id="${id}"]`,
      ) as HTMLElement | null;
      const w = node?.offsetWidth ?? 340;
      const h = node?.offsetHeight ?? 160;
      const rect = el.getBoundingClientRect();
      setView((v) => ({
        scale: v.scale,
        x: rect.width / 2 - ((b.x ?? 0) + w / 2) * v.scale,
        y: rect.height / 2 - ((b.y ?? 0) + h / 2) * v.scale,
      }));
    },
    [canvasRef, doc.blocks, setView],
  );

  // Tidy the canvas: pack every block (keeping connected stacks intact) into a
  // compact, non-overlapping grid around where the blocks already sit, then fit
  // the result in view. Rescues a sprawled-out canvas in one click.
  const organize = useCallback(() => {
    const el = canvasRef.current;
    if (!el || doc.blocks.length === 0) return;
    const conn = doc.connections ?? {};
    const exists = (id: string) => doc.blocks.some((b) => b.id === id);
    const sizeOf = (id: string) => {
      const node = el.querySelector(
        `[data-block-id="${id}"]`,
      ) as HTMLElement | null;
      return { w: node?.offsetWidth ?? 340, h: node?.offsetHeight ?? 160 };
    };

    // A connected stack moves as one unit. Heads are blocks not snapped beneath
    // another existing block; each head's chain follows the connections down.
    const childIds = new Set(
      Object.keys(conn).filter((c) => exists(c) && exists(conn[c])),
    );
    const chainOf = (headId: string) => {
      const chain = [headId];
      let cur = headId;
      while (chain.length < doc.blocks.length) {
        const next = Object.keys(conn).find(
          (c) => conn[c] === cur && !chain.includes(c) && exists(c),
        );
        if (!next) break;
        chain.push(next);
        cur = next;
      }
      return chain;
    };

    type Unit = { ids: string[]; sizes: { w: number; h: number }[]; w: number; h: number };
    const units: Unit[] = [];
    const placed = new Set<string>();
    for (const b of doc.blocks) {
      if (childIds.has(b.id) || placed.has(b.id)) continue;
      const ids = chainOf(b.id);
      ids.forEach((id) => placed.add(id));
      const sizes = ids.map(sizeOf);
      units.push({
        ids,
        sizes,
        w: Math.max(...sizes.map((s) => s.w)),
        h: sizes.reduce((a, s) => a + s.h, 0),
      });
    }
    // Safety net: any block missed by the chain walk (e.g. a stale cycle) packs
    // on its own so nothing is ever lost.
    for (const b of doc.blocks) {
      if (placed.has(b.id)) continue;
      const s = sizeOf(b.id);
      placed.add(b.id);
      units.push({ ids: [b.id], sizes: [s], w: s.w, h: s.h });
    }

    // Shelf-pack the units into rows aiming for a roughly square arrangement.
    const GAP = 32;
    const maxW = Math.max(...units.map((u) => u.w));
    const sumW = units.reduce((a, u) => a + u.w + GAP, 0);
    const targetRowW = Math.max(maxW, (sumW / units.length) * Math.ceil(Math.sqrt(units.length)));
    const placements: { u: Unit; x: number; y: number }[] = [];
    let cx = 0;
    let cy = 0;
    let rowH = 0;
    for (const u of units) {
      if (cx > 0 && cx + u.w > targetRowW) {
        cx = 0;
        cy += rowH + GAP;
        rowH = 0;
      }
      placements.push({ u, x: cx, y: cy });
      cx += u.w + GAP;
      rowH = Math.max(rowH, u.h);
    }
    const arrW = Math.max(...placements.map((p) => p.x + p.u.w));
    const arrH = Math.max(...placements.map((p) => p.y + p.u.h));

    // Centre the arrangement on the current blocks' centroid so they gather in
    // place rather than jumping to an arbitrary origin.
    let sumCx = 0;
    let sumCy = 0;
    for (const b of doc.blocks) {
      const s = sizeOf(b.id);
      sumCx += (b.x ?? 0) + s.w / 2;
      sumCy += (b.y ?? 0) + s.h / 2;
    }
    const offX = sumCx / doc.blocks.length - arrW / 2;
    const offY = sumCy / doc.blocks.length - arrH / 2;

    const moves: { id: string; x: number; y: number }[] = [];
    for (const p of placements) {
      let yy = offY + p.y;
      const xx = offX + p.x;
      p.u.ids.forEach((id, i) => {
        moves.push({ id, x: xx, y: yy });
        yy += p.u.sizes[i].h;
      });
    }
    dispatch({ type: "moveMany", moves });

    // Fit the freshly-packed box in view now (the reducer's new positions aren't
    // in `doc` yet, so compute the view from the arrangement directly).
    const rect = el.getBoundingClientRect();
    const pad = 80;
    const scale = Math.min(
      1.2,
      Math.max(0.3, Math.min((rect.width - pad * 2) / arrW, (rect.height - pad * 2) / arrH)),
    );
    setView(() => ({
      scale,
      x: rect.width / 2 - (offX + arrW / 2) * scale,
      y: rect.height / 2 - (offY + arrH / 2) * scale,
    }));
  }, [canvasRef, doc.blocks, doc.connections, dispatch, setView]);

  // Set an absolute zoom (from the slider), keeping the viewport centre fixed.
  const setZoom = useCallback(
    (pct: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      setView((v) => {
        const scale = Math.min(2.5, Math.max(0.3, pct / 100));
        const k = scale / v.scale;
        return { scale, x: cx - k * (cx - v.x), y: cy - k * (cy - v.y) };
      });
    },
    [canvasRef, setView],
  );

  const s = view.scale;
  const grid: React.CSSProperties = {
    backgroundColor: "oklch(0.94 0.016 250)",
    backgroundImage: [
      "linear-gradient(to right, oklch(0.225 0.035 262 / 0.05) 1px, transparent 1px)",
      "linear-gradient(to bottom, oklch(0.225 0.035 262 / 0.05) 1px, transparent 1px)",
      "linear-gradient(to right, oklch(0.225 0.035 262 / 0.025) 1px, transparent 1px)",
      "linear-gradient(to bottom, oklch(0.225 0.035 262 / 0.025) 1px, transparent 1px)",
    ].join(", "),
    backgroundSize: `${120 * s}px ${120 * s}px, ${120 * s}px ${120 * s}px, ${24 * s}px ${24 * s}px, ${24 * s}px ${24 * s}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  return (
    <div
      ref={(el) => {
        canvasRef.current = el;
        setNodeRef(el);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerLeave={endPan}
      style={grid}
      className={`relative h-full flex-1 overflow-hidden ${grabbing ? "cursor-grabbing" : "cursor-grab"}`}
    >
      {doc.blocks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <LayoutGrid className="size-12 text-foreground/15" />
          <p className="text-sm font-medium text-foreground/40">
            Drag blocks onto the canvas
          </p>
          <p className="text-xs text-muted-foreground/60">
            Scroll or drag to pan · pinch or use the slider to zoom
          </p>
        </div>
      )}

      {/* Transformed content layer */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${view.x}px, ${view.y}px) scale(${s})`,
          transformOrigin: "0 0",
        }}
      >
        {doc.blocks.map((block) => (
          <MainBlock
            key={block.id}
            block={block}
            activeChildKind={activeChildKind}
            following={followers.includes(block.id) ? followDelta : null}
            onResize={onResize}
            scale={s}
          />
        ))}
      </div>

      {/* List view: an outline of every block, with click-to-jump navigation. */}
      {listOpen && (
        <BlockList
          blocks={doc.blocks}
          onFocus={(id) => {
            setListOpen(false);
            focusBlock(id);
          }}
          onClose={() => setListOpen(false)}
        />
      )}

      {/* Zoom control (slider revealed on hover) + list / organize / fit */}
      <div className="group absolute bottom-3 right-3 flex items-center gap-1.5">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setListOpen((v) => !v)}
          title="List view — browse all blocks"
          aria-label="List view"
          aria-pressed={listOpen}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium backdrop-blur-sm transition-colors ${
            listOpen
              ? "border-foreground/20 bg-card text-foreground"
              : "border-border bg-card/80 text-muted-foreground hover:bg-card hover:text-foreground"
          }`}
        >
          <List className="size-3" />
          List
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={organize}
          disabled={doc.blocks.length === 0}
          title="Organize — tidy blocks into a compact layout"
          aria-label="Organize blocks"
          className="flex items-center gap-1 rounded-md border border-border bg-card/80 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Shrink className="size-3" />
          Organize
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={fitToBlocks}
          title={doc.blocks.length ? "Fit all blocks in view" : "Reset view"}
          aria-label="Fit all blocks in view"
          className="flex items-center gap-1 rounded-md border border-border bg-card/80 px-2 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:bg-card hover:text-foreground"
        >
          <Maximize2 className="size-3" />
          Fit
        </button>
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 py-1 backdrop-blur-sm">
          <input
            type="range"
            min={30}
            max={250}
            step={5}
            value={Math.round(s * 100)}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom level"
            title="Zoom"
            className="h-1 w-0 cursor-pointer opacity-0 accent-accent transition-all duration-150 group-hover:w-28 group-hover:opacity-100"
          />
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setZoom(100)}
            title="Reset to 100%"
            className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {Math.round(s * 100)}%
          </button>
        </div>
      </div>
    </div>
  );
}
