import { useSyncExternalStore } from 'react';

// How many bottom sheets (components/ui/Sheet) are open right now. A sheet stands over the
// phone's bottom tab bar, and the Emergency button lives in that bar, so App.jsx floats the
// button above any open sheet instead of leaving it covered (Emergency batch, E1: never out
// of reach). Kept here, not in Sheet.jsx, so that file exports only its component.

let openCount = 0;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

/** Marks one sheet open; returns the function that marks it closed again. */
export function markSheetOpen() {
  openCount += 1;
  emit();
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    openCount -= 1;
    emit();
  };
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => openCount > 0;

/** True while at least one sheet is open, re-rendering when that changes. */
export function useAnySheetOpen() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
