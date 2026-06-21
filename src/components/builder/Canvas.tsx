"use client";

// The workspace: a pan/zoom viewport (dual line-grid) holding a transformed
// content layer where the main blocks live at absolute positions.

import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { LayoutGrid, Maximize2 } from "lucide-react";
import type { BlockKind } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { MainBlock } from "./MainBlock";

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
  const { doc } = useProject();
  const { setNodeRef } = useDroppable({ id: "canvas" });
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  // Wheel zoom toward the cursor (native, non-passive so we can preventDefault).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const scale = Math.min(2.5, Math.max(0.3, v.scale * factor));
        const k = scale / v.scale;
        return { scale, x: mx - k * (mx - v.x), y: my - k * (my - v.y) };
      });
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

  const s = view.scale;
  const grid: React.CSSProperties = {
    backgroundColor: "oklch(0.94 0.016 82)",
    backgroundImage: [
      "linear-gradient(to right, oklch(0.16 0.035 58 / 0.05) 1px, transparent 1px)",
      "linear-gradient(to bottom, oklch(0.16 0.035 58 / 0.05) 1px, transparent 1px)",
      "linear-gradient(to right, oklch(0.16 0.035 58 / 0.025) 1px, transparent 1px)",
      "linear-gradient(to bottom, oklch(0.16 0.035 58 / 0.025) 1px, transparent 1px)",
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
            Scroll to zoom · drag the background to pan
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

      {/* Zoom indicator + fit-to-blocks control */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
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
        <div className="pointer-events-none rounded-md border border-border bg-card/80 px-2 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-sm">
          {Math.round(s * 100)}%
        </div>
      </div>
    </div>
  );
}
