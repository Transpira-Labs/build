"use client";

// The blank workspace. Starts empty; main blocks render at absolute positions
// and can be moved around.

import { useDroppable } from "@dnd-kit/core";
import type { RefObject } from "react";
import type { BlockKind } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { MainBlock } from "./MainBlock";

export function Canvas({
  activeChildKind,
  canvasRef,
  followers,
  followDelta,
  onResize,
}: {
  activeChildKind: BlockKind | null;
  canvasRef: RefObject<HTMLDivElement | null>;
  followers: string[];
  followDelta: { x: number; y: number };
  onResize: (id: string) => void;
}) {
  const { doc } = useProject();
  const { kids } = useKidsMode();
  const { setNodeRef } = useDroppable({ id: "canvas" });

  return (
    <div
      ref={(el) => {
        canvasRef.current = el;
        setNodeRef(el);
      }}
      className="canvas-grid relative h-full flex-1 overflow-auto"
    >
      {doc.blocks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="font-display text-xl font-semibold text-foreground/45">
            Start here
          </div>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            {kids
              ? "Snap a block from the left to begin."
              : "Drag a block from the left to begin."}
          </p>
        </div>
      )}

      {doc.blocks.map((block) => (
        <MainBlock
          key={block.id}
          block={block}
          activeChildKind={activeChildKind}
          following={followers.includes(block.id) ? followDelta : null}
          onResize={onResize}
          // Snapped beneath another block → show a seam highlight at its top.
          connected={!!doc.connections?.[block.id]}
        />
      ))}
    </div>
  );
}
