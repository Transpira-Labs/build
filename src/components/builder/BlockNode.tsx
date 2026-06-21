"use client";

// A nested block inside a main block — recursive. A "group" block (e.g. Scoring)
// renders a header plus a droppable body holding more BlockNodes; a "leaf" block
// renders its value editor. Both are sortable within their parent.

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BLOCKS, canAdd, type Block, type BlockKind } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { FieldEditor } from "./FieldEditor";
import { HelpPopover } from "./HelpPopover";
import { CloseIcon, GripIcon } from "./icons";

export function BlockNode({
  block,
  parentId,
  activeChildKind,
}: {
  block: Block;
  parentId: string;
  activeChildKind: BlockKind | null;
}) {
  const { dispatch } = useProject();
  const def = BLOCKS[block.kind];

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: block.id,
      data: { type: "sub", id: block.id, parentId, kind: block.kind },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    borderLeftColor: def.color,
    "--block-color": def.color,
  } as React.CSSProperties;

  const isGroup = def.role === "group";
  const accepts = activeChildKind ? canAdd(block, activeChildKind) : false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`kids-block relative rounded-md border border-border border-l-2 bg-card shadow-sm ${
        accepts ? "ring-2 ring-accent ring-offset-1" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 px-2 pt-1.5">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripIcon className="h-3.5 w-3.5" />
        </button>
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: def.color }}
        >
          {def.label}
        </span>
        {isGroup && <HelpPopover kind={block.kind} />}
        <button
          onClick={() => dispatch({ type: "removeBlock", id: block.id })}
          className="ml-auto rounded p-0.5 text-muted-foreground/40 hover:bg-muted hover:text-destructive"
          aria-label={`Remove ${def.label}`}
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {isGroup ? (
        <GroupBody block={block} activeChildKind={activeChildKind} accepts={accepts} />
      ) : (
        <div className="px-2 pb-2 pt-1">
          <FieldEditor block={block} />
        </div>
      )}
    </div>
  );
}

function GroupBody({
  block,
  activeChildKind,
  accepts,
}: {
  block: Block;
  activeChildKind: BlockKind | null;
  accepts: boolean;
}) {
  const { kids } = useKidsMode();
  const def = BLOCKS[block.kind];
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${block.id}`,
    data: { type: "container", blockId: block.id },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ backgroundColor: def.tint }}
      className="m-1.5 mt-1 space-y-1.5 rounded-md border border-border/60 px-1.5 py-1.5"
    >
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
        className={`rounded-md border border-dashed px-2 py-1.5 text-center text-[11px] font-medium transition-colors ${
          accepts || isOver
            ? "border-accent bg-accent/5 text-accent"
            : "border-border text-muted-foreground/60"
        }`}
      >
        {kids ? "Snap blocks here" : "Drag blocks here"}
      </div>
    </div>
  );
}
