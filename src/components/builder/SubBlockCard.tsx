"use client";

// One sub-block inside a container. Sortable (drag to reorder within its
// container) and typed by kind: text, reward, or setting.

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SUB_BLOCKS, type SubBlock } from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { RewardEditor } from "./RewardEditor";
import { SettingEditor } from "./SettingEditor";

export function SubBlockCard({
  containerId,
  block,
}: {
  containerId: string;
  block: SubBlock;
}) {
  const { dispatch } = useProject();
  const def = SUB_BLOCKS[block.kind];

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: block.id,
      data: { type: "sub", containerId, subId: block.id, subKind: block.kind },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          title="Drag to reorder"
        >
          ⠿
        </button>
        <span className="text-sm" aria-hidden>
          {def.icon}
        </span>
        <span className="text-sm font-semibold">{def.label}</span>
        <span className="ml-1 hidden truncate text-xs text-muted-foreground sm:inline">
          {def.hint}
        </span>
        <button
          onClick={() =>
            dispatch({ type: "removeSubBlock", containerId, subId: block.id })
          }
          className="ml-auto rounded px-1.5 text-muted-foreground/50 hover:bg-muted hover:text-destructive"
          aria-label={`Remove ${def.label} block`}
          title="Remove"
        >
          ✕
        </button>
      </div>

      <div className="px-2.5 pb-2.5 pt-1.5">
        {def.valueType === "text" && (
          <textarea
            value={block.text ?? ""}
            onChange={(e) =>
              dispatch({
                type: "setText",
                containerId,
                subId: block.id,
                text: e.target.value,
              })
            }
            placeholder={def.placeholder}
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-card px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-ring"
          />
        )}
        {def.valueType === "reward" && block.reward && (
          <RewardEditor
            containerId={containerId}
            subId={block.id}
            reward={block.reward}
          />
        )}
        {def.valueType === "setting" && block.setting && (
          <SettingEditor
            containerId={containerId}
            subId={block.id}
            setting={block.setting}
          />
        )}
      </div>
    </div>
  );
}
