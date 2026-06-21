"use client";

// The "?" help affordance shown on main and group blocks. Explains what the
// block is for and lists the blocks allowed inside it (marking which are needed
// and which can repeat).

import { useState } from "react";
import { BLOCKS, isRequired, type BlockKind } from "@/lib/blocks/model";
import { QuestionIcon } from "./icons";

export function HelpPopover({ kind }: { kind: BlockKind }) {
  const [open, setOpen] = useState(false);
  const def = BLOCKS[kind];

  return (
    <>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-full p-0.5 transition-colors ${
          open
            ? "bg-muted text-foreground"
            : "text-muted-foreground/40 hover:bg-muted hover:text-foreground"
        }`}
        aria-label={`What goes in the ${def.label} block?`}
        aria-expanded={open}
        title="What's this block for?"
      >
        <QuestionIcon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onPointerDown={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute left-3 top-9 z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-xl"
          >
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: def.color }}
            >
              {def.label}
            </span>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {def.help}
            </p>

            {def.accepts && def.accepts.length > 0 && (
              <>
                <div className="mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Blocks you can add
                </div>
                <ul className="mt-1 space-y-1">
                  {def.accepts.map((ck) => {
                    const cd = BLOCKS[ck];
                    return (
                      <li key={ck} className="flex gap-1.5 text-xs">
                        <span
                          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cd.color }}
                        />
                        <span>
                          <span className="font-medium text-foreground">
                            {cd.label}
                          </span>
                          {cd.role === "group" && (
                            <span className="text-muted-foreground/60"> (holds more)</span>
                          )}
                          {isRequired(kind, ck) && (
                            <span className="font-medium text-accent"> · needed</span>
                          )}
                          {cd.repeatable && (
                            <span className="text-muted-foreground/60"> (many)</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
