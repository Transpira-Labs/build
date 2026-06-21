"use client";

// The left column (itch-style): a "Blocks" header, a search box, then the blocks
// grouped by main block (collapsed by default). Searching flattens to matches.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  BLOCKS,
  descendants,
  firstMain,
  isRequired,
  MAIN_KINDS,
  type BlockKind,
  type MainKind,
} from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { MainPaletteItem, SubPaletteItem } from "./PaletteItem";

export function Palette() {
  const { doc } = useProject();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // Flat, de-duped search results across every main block's subtree.
  const results = useMemo(() => {
    if (!q) return null;
    const mains: MainKind[] = [];
    const subs: { kind: BlockKind; from: MainKind; required: boolean }[] = [];
    const seenSub = new Set<BlockKind>();
    for (const kind of MAIN_KINDS) {
      if (BLOCKS[kind].label.toLowerCase().includes(q)) mains.push(kind);
      for (const d of descendants(kind)) {
        if (seenSub.has(d.kind)) continue;
        if (BLOCKS[d.kind].label.toLowerCase().includes(q)) {
          seenSub.add(d.kind);
          subs.push({ kind: d.kind, from: kind, required: isRequired(d.parent, d.kind) });
        }
      }
    }
    return { mains, subs };
  }, [q]);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Blocks
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blocks…"
            className="w-full rounded-lg border border-input bg-background py-1.5 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-ring"
          />
        </div>

        {results ? (
          <div className="space-y-1.5">
            {results.mains.map((kind) => (
              <MainPaletteItem
                key={kind}
                kind={kind}
                disabled={BLOCKS[kind].singleton && !!firstMain(doc, kind)}
                expanded={false}
                onToggle={() => {}}
              />
            ))}
            {results.subs.map((s) => (
              <SubPaletteItem
                key={s.kind}
                kind={s.kind}
                from={s.from}
                required={s.required}
              />
            ))}
            {results.mains.length === 0 && results.subs.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No blocks match.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {MAIN_KINDS.map((kind) => {
              const placed = !!firstMain(doc, kind);
              const expanded = !!open[kind];
              return (
                <div key={kind} className="space-y-1.5">
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
        )}
      </div>
    </aside>
  );
}
