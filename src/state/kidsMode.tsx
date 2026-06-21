"use client";

// Kids Mode: a UI-only toggle (no effect on the saved doc) that swaps the
// builder's wording for kid-friendly copy and switches on the chunky, bright,
// Scratch-style skin. The preference is per-browser, persisted in localStorage
// so it sticks across environments and reloads.
//
// Backed by useSyncExternalStore (like ../lib/library): the server snapshot is
// always false so SSR and the first client render agree, then the real value is
// read on the client. Writing notifies every reader, and the `storage` event
// keeps other tabs in sync.

import { useCallback, useSyncExternalStore } from "react";

const KEY = "transpira:kidsMode";

const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): boolean {
  return false;
}

function write(kids: boolean): void {
  try {
    window.localStorage.setItem(KEY, kids ? "1" : "0");
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function useKidsMode() {
  const stored = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const toggle = useCallback(() => write(!read()), []);
  // Kids mode is currently switched off everywhere (its toggle is hidden). The
  // store wiring above is kept intact — to re-enable, return `stored` as `kids`.
  void stored;
  return { kids: false, toggle };
}
