// The environment library: where every environment a user builds is saved.
//
// The editor works on one ProjectDoc at a time; this module is the shelf that
// holds all of them so the dashboard can list, open, create, and delete. There
// is no backend, so the shelf lives in localStorage under a single key.
//
// React reads the shelf through useSyncExternalStore (see the hooks at the
// bottom): the snapshot is cached and only recomputed when something writes,
// which also lets other tabs stay in sync via the `storage` event.

import { useSyncExternalStore } from "react";
import { emptyProject, type ProjectDoc } from "@/lib/blocks/model";

const KEY = "transpira:environments:v1";

export interface StoredEnv {
  doc: ProjectDoc;
  /** Epoch ms of the last save. Drives "edited 2h ago" and list ordering. */
  updatedAt: number;
}

// Stable reference returned during SSR / before hydration. Components compare
// against it (by identity) to know the real shelf hasn't been read yet.
const SERVER_SNAPSHOT: StoredEnv[] = [];

const listeners = new Set<() => void>();
let cache: StoredEnv[] | null = null;

function rawRead(): StoredEnv[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredEnv[]) : [];
  } catch {
    return [];
  }
}

function write(list: StoredEnv[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(list));
  cache = null; // invalidate; next getSnapshot reflects the write
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Cached snapshot, most recently edited first. Stable until the shelf changes. */
function getSnapshot(): StoredEnv[] {
  if (cache === null) {
    cache = rawRead().sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return cache;
}

function getServerSnapshot(): StoredEnv[] {
  return SERVER_SNAPSHOT;
}

// ---------------------------------------------------------------------------
// Reads (non-reactive — for event handlers and the editor route)
// ---------------------------------------------------------------------------

export function listEnvironments(): StoredEnv[] {
  return getSnapshot();
}

export function getEnvironment(id: string): ProjectDoc | null {
  return getSnapshot().find((e) => e.doc.id === id)?.doc ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Create a fresh, empty environment, persist it, and return the new doc. */
export function createEnvironment(name?: string): ProjectDoc {
  const doc = emptyProject(name?.trim() || "Untitled environment");
  write([{ doc, updatedAt: Date.now() }, ...rawRead()]);
  return doc;
}

/** Insert or update an environment, stamping it as just-edited. */
export function saveEnvironment(doc: ProjectDoc): void {
  const list = rawRead().filter((e) => e.doc.id !== doc.id);
  write([{ doc, updatedAt: Date.now() }, ...list]);
}

export function deleteEnvironment(id: string): void {
  write(rawRead().filter((e) => e.doc.id !== id));
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

/** The live shelf. `ready` is false until localStorage has been read on the client. */
export function useEnvironments(): { envs: StoredEnv[]; ready: boolean } {
  const envs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { envs, ready: envs !== SERVER_SNAPSHOT };
}

/** One environment by id, kept in sync with the shelf. */
export function useEnvironment(id: string): {
  doc: ProjectDoc | null;
  ready: boolean;
} {
  const { envs, ready } = useEnvironments();
  return { doc: envs.find((e) => e.doc.id === id)?.doc ?? null, ready };
}
