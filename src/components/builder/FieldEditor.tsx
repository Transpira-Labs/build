"use client";

// Renders a leaf block's value editor: text, choice, number, or reference.

import { BLOCKS, type Block } from "@/lib/blocks/model";
import { useProject } from "@/state/project";

const field =
  "w-full rounded-md border border-black/10 bg-white/85 px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-ring";

export function FieldEditor({ block }: { block: Block }) {
  const { dispatch } = useProject();
  const def = BLOCKS[block.kind];

  if (def.valueType === "text") {
    return (
      <textarea
        value={block.text ?? ""}
        onChange={(e) =>
          dispatch({ type: "setText", id: block.id, text: e.target.value })
        }
        rows={2}
        className={`resize-none ${field}`}
      />
    );
  }

  if (def.valueType === "choice") {
    return (
      <select
        value={block.text ?? ""}
        onChange={(e) =>
          dispatch({ type: "setText", id: block.id, text: e.target.value })
        }
        className={field}
      >
        {def.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (def.valueType === "number" && def.number) {
    const n = block.num ?? def.number.default;
    return (
      <div>
        <div className="mb-1 text-sm font-medium text-muted-foreground">
          {n} {def.number.unit}
        </div>
        <input
          type="range"
          min={def.number.min}
          max={def.number.max}
          step={def.number.step}
          value={n}
          onChange={(e) =>
            dispatch({ type: "setNum", id: block.id, num: Number(e.target.value) })
          }
          className="w-full accent-accent"
        />
      </div>
    );
  }

  if (def.valueType === "reference" && block.reference) {
    const ref = block.reference;
    const patch = (p: Partial<typeof ref>) =>
      dispatch({ type: "patchReference", id: block.id, patch: p });
    return (
      <div className="space-y-1.5">
        <div className="inline-flex overflow-hidden rounded-md border border-input text-xs">
          {(["link", "upload"] as const).map((m) => (
            <button
              key={m}
              onClick={() => patch({ mode: m, value: "" })}
              className={`px-2.5 py-1 font-medium capitalize ${
                ref.mode === m
                  ? "bg-accent text-accent-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {ref.mode === "link" ? (
          <input
            type="url"
            value={ref.value}
            onChange={(e) => patch({ value: e.target.value })}
            className={field}
          />
        ) : (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <span className="rounded-md border border-input bg-background px-2.5 py-1.5 font-medium hover:bg-muted">
              Choose file
            </span>
            <span className="truncate text-muted-foreground">
              {ref.value || "No file chosen"}
            </span>
            <input
              type="file"
              className="hidden"
              onChange={(e) => patch({ value: e.target.files?.[0]?.name ?? "" })}
            />
          </label>
        )}
      </div>
    );
  }

  return null;
}
