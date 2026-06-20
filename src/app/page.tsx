"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useProject, ProjectProvider } from "@/state/project";
import { toIR } from "@/lib/ir/schema";

// Render the drag-and-drop canvas client-only: dnd-kit generates ids that don't
// survive SSR hydration, and the builder has no SEO/SSR value.
const Builder = dynamic(
  () => import("@/components/builder/Builder").then((m) => m.Builder),
  { ssr: false, loading: () => <div className="canvas-grid h-full w-full" /> },
);

function TopBar() {
  const { doc, dispatch } = useProject();
  const [peek, setPeek] = useState(false);

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>
          🧪
        </span>
        <span className="font-display text-lg font-semibold">Helper Lab</span>
      </div>
      <input
        value={doc.name}
        onChange={(e) => dispatch({ type: "setName", name: e.target.value })}
        aria-label="Project name"
        className="rounded-md border border-input bg-background px-2.5 py-1 text-sm font-semibold outline-none focus:border-accent focus:ring-2 focus:ring-ring"
      />

      <div className="ml-auto flex items-center gap-2 text-sm">
        <button
          onClick={() => setPeek((p) => !p)}
          className="rounded-md px-2.5 py-1.5 font-medium text-muted-foreground hover:bg-muted"
        >
          {peek ? "Hide" : "Under the hood"}
        </button>
        {/* Wired up in later build steps (pre-build check → build & practice). */}
        <button
          disabled
          className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 font-semibold text-muted-foreground/60"
          title="Coming next"
        >
          ✓ Check it
        </button>
        <button
          disabled
          className="cursor-not-allowed rounded-md bg-primary/40 px-3 py-1.5 font-semibold text-primary-foreground"
          title="Coming next"
        >
          ▶ Build &amp; practice
        </button>
      </div>

      {peek && (
        <pre className="fixed bottom-4 right-4 z-50 max-h-[60vh] w-96 overflow-auto rounded-xl border border-border bg-foreground p-4 text-xs leading-relaxed text-background shadow-2xl">
          {JSON.stringify(toIR(doc), null, 2)}
        </pre>
      )}
    </header>
  );
}

export default function Home() {
  return (
    <ProjectProvider>
      <div className="flex h-screen flex-col">
        <TopBar />
        <div className="min-h-0 flex-1">
          <Builder />
        </div>
      </div>
    </ProjectProvider>
  );
}
