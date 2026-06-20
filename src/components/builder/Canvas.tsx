"use client";

// The blank workspace. Starts empty; the user drags blocks here to build. Placed
// containers render at absolute positions and can be moved around.

import { useDroppable } from "@dnd-kit/core";
import type { RefObject } from "react";
import type { SubKind } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { Container } from "./Container";

export function Canvas({
  activeSubKind,
  canvasRef,
}: {
  activeSubKind: SubKind | null;
  canvasRef: RefObject<HTMLDivElement | null>;
}) {
  const { doc } = useProject();
  const { setNodeRef, isOver } = useDroppable({ id: "canvas" });

  return (
    <div
      ref={(el) => {
        canvasRef.current = el;
        setNodeRef(el);
      }}
      className={`canvas-grid relative h-full flex-1 overflow-auto ${
        isOver ? "inset-shadow" : ""
      }`}
    >
      {doc.blocks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="font-display text-2xl font-semibold text-foreground/40">
            Your canvas is empty
          </div>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">
            Drag a block from the left to start building your helper. Begin with
            the <span className="font-semibold">Helper</span> block.
          </p>
        </div>
      )}

      {doc.blocks.map((block) => (
        <Container key={block.id} instance={block} activeSubKind={activeSubKind} />
      ))}
    </div>
  );
}
