"use client";

// The home screen: a shelf of every environment the user has built. From here
// they open an existing one, spin up a new one, or — if they're new — follow
// the welcome card into a guide. The builder itself lives at /build/[id].

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createEnvironment,
  deleteEnvironment,
  saveEnvironment,
  useEnvironments,
  type StoredEnv,
} from "@/lib/library";
import { TEMPLATES, type Template } from "@/lib/templates";
import { firstMain, type ProjectDoc } from "@/lib/blocks/model";

export function Dashboard() {
  const router = useRouter();
  // `ready` is false until the shelf has been read on the client, so we hold
  // off on the empty state instead of flashing it during the first paint.
  const { envs, ready } = useEnvironments();

  function handleCreate() {
    const doc = createEnvironment();
    router.push(`/build/${doc.id}`);
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    deleteEnvironment(id);
  }

  // Copy a template into the user's own shelf, then open the copy to build off.
  function handleUseTemplate(t: Template) {
    const doc = t.build();
    saveEnvironment(doc);
    router.push(`/build/${doc.id}`);
  }

  const hasEnvs = ready && envs.length > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-6 py-3">
        <span className="font-display text-base font-semibold">Transpira</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm font-semibold text-muted-foreground">
          Environments
        </span>
        <button
          onClick={handleCreate}
          className="ml-auto rounded-md bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          New environment
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <WelcomeCard />

          <div className="mb-4 mt-10 flex items-baseline justify-between">
            <h2 className="font-display text-xl font-semibold">
              Your environments
            </h2>
            {hasEnvs && (
              <span className="text-sm text-muted-foreground">
                {envs.length} {envs.length === 1 ? "environment" : "environments"}
              </span>
            )}
          </div>

          {!ready ? null : envs.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NewCard onCreate={handleCreate} />
              {envs.map((e) => (
                <EnvCard
                  key={e.doc.id}
                  env={e}
                  onDelete={() => handleDelete(e.doc.id, e.doc.name)}
                />
              ))}
            </div>
          )}

          <section className="mt-12">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-xl font-semibold">
                Start from a template
              </h2>
              <span className="text-sm text-muted-foreground">
                Complete, runnable environments
              </span>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Open a copy to explore how it&apos;s built, then make it your own.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TEMPLATES.map((t) => (
                <TemplateCard
                  key={t.key}
                  template={t}
                  onUse={() => handleUseTemplate(t)}
                />
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-user welcome — a deliberately prominent entry point. The CTA is a
// placeholder for now (the guide / tour isn't built yet), so it links nowhere.
// ---------------------------------------------------------------------------

function WelcomeCard() {
  return (
    <section className="overflow-hidden rounded-2xl border border-accent/25 bg-accent/10 p-6 sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
            New here?
          </p>
          <h1 className="font-display text-2xl font-semibold">
            Build a training environment by snapping blocks together
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            No code required. Describe what your agent should do, add a few
            tasks, and pick how it learns — then build and train.
          </p>
        </div>
        {/* Placeholder destination — wired up to the guided tour in a later step. */}
        <a
          href="#"
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Take the tour
          <span aria-hidden>→</span>
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  onUse,
}: {
  template: Template;
  onUse: () => void;
}) {
  return (
    <button
      onClick={onUse}
      className="group flex min-h-[172px] flex-col rounded-xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: template.color }}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {template.tag}
        </span>
      </span>
      <h3 className="mt-2.5 font-display text-lg font-semibold">
        {template.title}
      </h3>
      <p className="mt-1 line-clamp-3 flex-1 text-sm leading-relaxed text-muted-foreground">
        {template.blurb}
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
        Use template
        <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </button>
  );
}

function NewCard({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      onClick={onCreate}
      className="group flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-5 text-muted-foreground transition hover:border-accent hover:bg-card hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-current text-xl leading-none">
        +
      </span>
      <span className="text-sm font-semibold">New environment</span>
    </button>
  );
}

function EnvCard({
  env,
  onDelete,
}: {
  env: StoredEnv;
  onDelete: () => void;
}) {
  const { doc, updatedAt } = env;
  const overview = environmentOverview(doc);
  const count = doc.blocks.length;

  return (
    <div className="group relative flex min-h-[148px] flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md">
      {/* Full-card click target; the delete button sits above it. */}
      <Link
        href={`/build/${doc.id}`}
        aria-label={`Open ${doc.name}`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
        <h3 className="truncate font-display text-lg font-semibold">
          {doc.name}
        </h3>
        <p className="mt-1.5 line-clamp-2 flex-1 text-sm leading-relaxed text-muted-foreground">
          {overview || "No description yet — open it to start building."}
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{count === 0 ? "Empty" : `${count} block${count === 1 ? "" : "s"}`}</span>
          <span aria-hidden>·</span>
          <span>Edited {timeAgo(updatedAt)}</span>
        </div>
      </div>

      <button
        onClick={onDelete}
        aria-label={`Delete ${doc.name}`}
        className="pointer-events-auto absolute right-2.5 top-2.5 z-10 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover:opacity-100"
      >
        Delete
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <p className="font-display text-lg font-semibold">No environments yet</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Create your first environment to start snapping blocks together.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        New environment
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The environment block's one-line overview, used as the card subtitle. */
function environmentOverview(doc: ProjectDoc): string {
  const env = firstMain(doc, "environment");
  const overview = env?.children.find((c) => c.kind === "overview");
  return overview?.text?.trim() ?? "";
}

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
