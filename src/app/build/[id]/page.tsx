"use client";

// The editor route: /build/[id]. Loads one environment out of the library into
// the ProjectProvider, then keeps localStorage in sync with every edit. The
// drag-and-drop canvas is rendered client-only (dnd-kit ids don't survive SSR
// hydration, and the builder has no SSR value).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, Check, FlaskConical } from "lucide-react";
import { useProject, ProjectProvider } from "@/state/project";
import { useKidsMode } from "@/state/kidsMode";
import { saveEnvironment, useEnvironment } from "@/lib/library";
import { RightPanel } from "@/components/builder/RightPanel";
import { CheckButton } from "@/components/builder/CheckButton";
import { DeployButton } from "@/components/builder/DeployButton";
import type { Block } from "@/lib/blocks/model";

const Builder = dynamic(
  () => import("@/components/builder/Builder").then((m) => m.Builder),
  { ssr: false, loading: () => <div className="canvas-grid h-full w-full" /> },
);

/** Count tools and tasks anywhere in the block tree (for the header stats). */
function blockCounts(blocks: Block[]): { tools: number; tasks: number } {
  let tools = 0;
  let tasks = 0;
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.kind === "tool") tools++;
      if (b.kind === "task") tasks++;
      if (b.children.length) walk(b.children);
    }
  };
  walk(blocks);
  return { tools, tasks };
}

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
  const [saved, setSaved] = useState(false);
  const { tools, tasks } = blockCounts(doc.blocks);

  const save = () => {
    saveEnvironment(doc);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2.5">
      <Link
        href="/"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Environments
      </Link>
      <span className="h-4 w-px bg-border" />
      <input
        value={doc.name}
        onChange={(e) => dispatch({ type: "setName", name: e.target.value })}
        aria-label="Environment name"
        placeholder="Untitled environment"
        className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground/50"
      />
      <span className="h-4 w-px bg-border" />
      <span className="shrink-0 text-xs text-muted-foreground">
        {tools} tool{tools === 1 ? "" : "s"} · {tasks} task{tasks === 1 ? "" : "s"}
      </span>

      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={save}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          {saved ? (
            <>
              <Check className="size-3.5 text-green-600" />
              <span className="text-green-600">Saved</span>
            </>
          ) : (
            "Save"
          )}
        </button>
        <CheckButton />
        {doc.deploy && (
          <Link
            href={`/build/${doc.id}/runs`}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            title="Open the test & training window for the last build"
          >
            <FlaskConical className="size-3.5" />
            Test &amp; train
          </Link>
        )}
        <DeployButton />
      </div>
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
      <div className="flex min-h-0 flex-1">
        <Builder />
        <RightPanel />
      </div>
    </div>
  );
}
