"use client";

// The list view: a full-height outline of every block on the canvas, grouped by
// its top-level main block and nested to match the tree. Clicking a main block
// flies the canvas to it (and closes the list), so a busy canvas stays navigable.

import { ChevronRight, X } from "lucide-react";
import { BLOCKS, type Block } from "@/lib/blocks/model";

function blockTitle(b: Block): string {
  const def = BLOCKS[b.kind];
  if (def.hasName && b.name?.trim()) return b.name.trim();
  return def.label;
}

function blockValue(b: Block): string | null {
  if (b.text?.trim()) return b.text.trim();
  if (typeof b.num === "number") return `${b.num} ${b.kind === "set_size" ? "rounds" : ""}`.trim();
  if (b.reference?.value?.trim()) return b.reference.value.trim();
  return null;
}

function countDescendants(b: Block): number {
  return b.children.reduce((n, c) => n + 1 + countDescendants(c), 0);
}

// One nested (non-main) block: a coloured tick, its title, and a value preview.
function NestedRow({ block, depth }: { block: Block; depth: number }) {
  const def = BLOCKS[block.kind];
  const value = blockValue(block);
  return (
    <div>
      <div
        className="flex items-start gap-2 py-1"
        style={{ paddingLeft: depth * 14 }}
      >
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-[3px]"
          style={{ backgroundColor: def.color }}
        />
        <div className="min-w-0">
          <span className="text-xs font-medium text-foreground/80">
            {blockTitle(block)}
          </span>
          {value && (
            <span className="ml-1.5 truncate text-xs text-muted-foreground">
              {value}
            </span>
          )}
        </div>
      </div>
      {block.children.map((c) => (
        <NestedRow key={c.id} block={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export function BlockList({
  blocks,
  onFocus,
  onClose,
}: {
  blocks: Block[];
  onFocus: (id: string) => void;
  onClose: () => void;
}) {
  const total = blocks.reduce((n, b) => n + 1 + countDescendants(b), 0);

  return (
    <div className="absolute inset-y-0 left-0 z-20 flex w-80 flex-col border-r border-border bg-card/95 shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Blocks</h2>
          <p className="text-xs text-muted-foreground">
            {blocks.length} on canvas · {total} total
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Back to canvas"
          aria-label="Close list view"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {blocks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            No blocks yet. Drag blocks onto the canvas to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {blocks.map((block) => {
              const def = BLOCKS[block.kind];
              return (
                <li key={block.id}>
                  <button
                    type="button"
                    onClick={() => onFocus(block.id)}
                    title="Jump to this block"
                    className="group/item flex w-full items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2 text-left transition-colors hover:border-foreground/20 hover:bg-background"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-[4px]"
                      style={{ backgroundColor: def.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {blockTitle(block)}
                      </span>
                      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                        {def.label}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover/item:text-foreground" />
                  </button>

                  {block.children.length > 0 && (
                    <div className="mt-1 pl-2.5">
                      {block.children.map((c) => (
                        <NestedRow key={c.id} block={c} depth={0} />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
