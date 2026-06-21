"use client";

// The editor route: /build/[id]. Loads one environment out of the library into
// the ProjectProvider, then keeps localStorage in sync with every edit. The
// drag-and-drop canvas is rendered client-only (dnd-kit ids don't survive SSR
// hydration, and the builder has no SSR value).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useProject, ProjectProvider } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { saveEnvironment, useEnvironment } from "@/lib/library";
import { toIR } from "@/lib/ir/schema";

const Builder = dynamic(
  () => import("@/components/builder/Builder").then((m) => m.Builder),
  { ssr: false, loading: () => <div className="canvas-grid h-full w-full" /> },
);

// Hidden for now — kept so kids mode can be re-enabled by un-commenting the
// <KidsModeToggle /> render above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function KidsModeToggle() {
  const { kids, toggle } = useKidsMode();
  return (
    <button
      onClick={toggle}
      role="switch"
      aria-checked={kids}
      title={
        kids ? "Switch back to the standard view" : "Switch to the friendly view"
      }
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1 font-medium transition-colors ${
        kids
          ? "border-accent bg-accent/15 text-accent"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {/* Knob slides via flex justification — robust against any transform CSS. */}
      <span
        className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          kids ? "justify-end bg-accent" : "justify-start bg-muted-foreground/30"
        }`}
      >
        <span className="h-3 w-3 rounded-full bg-card shadow-sm" />
      </span>
      Kids Mode
    </button>
  );
}

function TopBar() {
  const { doc, dispatch } = useProject();
  const [peek, setPeek] = useState(false);

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <Link
          href="/"
          className="font-display text-base font-semibold hover:text-accent"
        >
          Environments
        </Link>
        <span className="text-muted-foreground/40">/</span>
      </div>
      <input
        value={doc.name}
        onChange={(e) => dispatch({ type: "setName", name: e.target.value })}
        aria-label="Environment name"
        className="rounded-md border border-transparent bg-background px-2.5 py-1 text-sm font-semibold outline-none hover:border-border focus:border-accent focus:ring-2 focus:ring-ring"
      />

      <div className="ml-auto flex items-center gap-2 text-sm">
        {/* Kids mode toggle hidden for now (component kept below for later). */}
        {/* <KidsModeToggle /> */}
        <button
          onClick={() => setPeek((p) => !p)}
          className="rounded-md px-2.5 py-1.5 font-medium text-muted-foreground hover:bg-muted"
        >
          {peek ? "Hide" : "Under the hood"}
        </button>
        {/* Wired up in later build steps (pre-build check → build & practice). */}
        <button
          disabled
          className="cursor-not-allowed rounded-md border border-border px-3 py-1.5 font-medium text-muted-foreground/60"
          title="Coming next"
        >
          Check it
        </button>
        <button
          disabled
          className="cursor-not-allowed rounded-md bg-accent/40 px-3 py-1.5 font-medium text-accent-foreground"
          title="Coming next"
        >
          Build &amp; train
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

/** Mirrors the live doc back into the library on every edit. */
function Persist() {
  const { doc } = useProject();
  useEffect(() => {
    saveEnvironment(doc);
  }, [doc]);
  return null;
}

export default function BuildPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { doc, ready } = useEnvironment(id);

  if (!ready) {
    return <div className="canvas-grid h-screen w-full" />;
  }

  if (!doc) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="font-display text-xl font-semibold">
          Environment not found
        </p>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or the link is wrong.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-105"
        >
          Back to environments
        </Link>
      </div>
    );
  }

  return (
    // Key by id so switching environments remounts with fresh initial state.
    <ProjectProvider key={id} initial={doc}>
      <BuildShell />
    </ProjectProvider>
  );
}

/** The editor chrome. Lives under both providers so it can flip the kids skin. */
function BuildShell() {
  const { kids } = useKidsMode();
  return (
    <div className={`flex h-screen flex-col ${kids ? "kids-mode" : ""}`}>
      <TopBar />
      <Persist />
      <div className="min-h-0 flex-1">
        <Builder />
      </div>
    </div>
  );
}
