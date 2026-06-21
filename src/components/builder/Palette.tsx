"use client";

// The left column. Collapsed by default to just the four main blocks; expand one
// to reveal the detail blocks that go under it (indented by how deep they nest).

import { useState } from "react";
import {
  BLOCKS,
  descendants,
  firstMain,
  isRequired,
  MAIN_KINDS,
  type MainKind,
} from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { MainPaletteItem, SubPaletteItem } from "./PaletteItem";

export function Palette() {
  const { doc } = useProject();
  const { kids } = useKidsMode();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-border bg-card ${
        kids ? "w-72" : "w-64"
      }`}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-display text-sm font-semibold">Blocks</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {kids
            ? "Snap blocks together to build."
            : "Drag a block onto the canvas."}
        </p>
      </div>

      <div
        className={`flex-1 overflow-y-auto px-3 py-3 ${
          kids ? "space-y-5" : "space-y-2"
        }`}
      >
        {MAIN_KINDS.map((kind: MainKind) => {
          const placed = !!firstMain(doc, kind);
          const expanded = !!open[kind];
          return (
            <div key={kind} className={kids ? "space-y-4" : "space-y-1.5"}>
              <MainPaletteItem
                kind={kind}
                disabled={BLOCKS[kind].singleton && placed}
                expanded={expanded}
                onToggle={() => setOpen((o) => ({ ...o, [kind]: !o[kind] }))}
              />
              {expanded &&
                descendants(kind).map((d) => (
                  <SubPaletteItem
                    key={`${kind}:${d.kind}:${d.depth}`}
                    from={kind}
                    kind={d.kind}
                    depth={d.depth}
                    required={isRequired(d.parent, d.kind)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
