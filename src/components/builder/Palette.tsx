"use client";

// The Scratch-style left side: a category rail + a scrollable block tray. Blocks
// are grouped by category (the four container colours), each category showing
// its container block followed by the sub-blocks that snap inside it.

import { useRef } from "react";
import {
  CATEGORY_ORDER,
  CONTAINERS,
  firstOfKind,
  subKindsFor,
  type ContainerKind,
} from "@/lib/blocks/model";
import { useProject } from "@/state/project";
import { ContainerPaletteItem, SubPaletteItem } from "./PaletteItem";

export function Palette() {
  const { doc } = useProject();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollTo = (kind: ContainerKind) => {
    sectionRefs.current[kind]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="flex h-full border-r border-border bg-card">
      {/* Category rail */}
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border py-3">
        {CATEGORY_ORDER.map((kind) => {
          const def = CONTAINERS[kind];
          return (
            <button
              key={kind}
              onClick={() => scrollTo(kind)}
              className="flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted"
              title={def.label}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm"
                style={{ backgroundColor: def.palette.base, color: def.palette.on }}
              >
                {def.icon}
              </span>
              <span className="leading-none">{def.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Block tray */}
      <div ref={scrollRef} className="w-56 shrink-0 overflow-y-auto px-3 py-3">
        {CATEGORY_ORDER.map((kind) => {
          const def = CONTAINERS[kind];
          const placed = !!firstOfKind(doc, kind);
          return (
            <div
              key={kind}
              ref={(el) => {
                sectionRefs.current[kind] = el;
              }}
              className="mb-5 scroll-mt-2"
            >
              <div className="mb-2 flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: def.palette.base }}
                />
                <span className="font-display text-sm font-semibold">
                  {def.label}
                </span>
              </div>

              <div className="space-y-1.5">
                <ContainerPaletteItem
                  kind={kind}
                  disabled={def.singleton && placed}
                />
                {subKindsFor(kind).map((sk) => (
                  <SubPaletteItem key={sk} subKind={sk} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
