"use client";

// Draggable blocks in the palette tray. A "container" item drags out onto the
// canvas to place a new C-block; a "sub" item drags into a container to snap in
// a sub-block. Styled to read like Scratch blocks in the warm-alpine palette.

import { useDraggable } from "@dnd-kit/core";
import {
  CONTAINERS,
  SUB_BLOCKS,
  type ContainerKind,
  type SubKind,
} from "@/lib/blocks/model";

export function ContainerPaletteItem({
  kind,
  disabled,
}: {
  kind: ContainerKind;
  disabled?: boolean;
}) {
  const def = CONTAINERS[kind];
  const pal = def.palette;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-container:${kind}`,
    data: { type: "palette-container", kind },
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
      style={{ opacity: isDragging ? 0.4 : disabled ? 0.45 : 1 }}
      className="w-full touch-none text-left disabled:cursor-not-allowed"
      disabled={disabled}
      title={disabled ? "Already on the canvas" : `Drag “${def.label}” onto the canvas`}
    >
      {/* mini C-block */}
      <div
        className="overflow-hidden rounded-lg shadow-sm"
        style={{ cursor: disabled ? "not-allowed" : "grab" }}
      >
        <div
          style={{ backgroundColor: pal.base, color: pal.on }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 font-display text-sm font-semibold"
        >
          <span aria-hidden>{def.icon}</span>
          {def.label}
          {disabled && <span className="ml-auto text-xs font-normal">✓ added</span>}
        </div>
        <div
          style={{ backgroundColor: pal.soft, borderColor: pal.base }}
          className="h-3 border-x-4 border-b-4 rounded-b-lg"
        />
      </div>
    </button>
  );
}

export function SubPaletteItem({ subKind }: { subKind: SubKind }) {
  const def = SUB_BLOCKS[subKind];
  const pal = CONTAINERS[def.container].palette;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-sub:${subKind}`,
    data: { type: "palette-sub", subKind },
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        backgroundColor: pal.base,
        color: pal.on,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="block-notch relative flex w-full cursor-grab touch-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold shadow-sm active:cursor-grabbing"
      title={def.hint}
    >
      <span aria-hidden>{def.icon}</span>
      <span>{def.label}</span>
    </button>
  );
}
