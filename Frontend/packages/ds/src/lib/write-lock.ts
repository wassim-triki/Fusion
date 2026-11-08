"use client";

import { useSyncExternalStore } from "react";

/**
 * Why changes can't be made in this app right now (B-220), or null. Set by the frame (seeing Fusion as someone); the
 * server refuses the change either way, this only lets the page say so before anyone tries.
 */
let reason: string | null = null;
const listeners = new Set<() => void>();

export function setWriteLock(next: string | null): void {
  if (next === reason) return;
  reason = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The reason changes are locked, or null. Null on the server, so the page hydrates the same. */
export function useWriteLock(): string | null {
  return useSyncExternalStore(subscribe, () => reason, () => null);
}
