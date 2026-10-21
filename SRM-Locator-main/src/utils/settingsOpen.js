import { useSyncExternalStore } from 'react';

// Whether Settings is open, outside App's state. It used to be App's own useState, so the
// tap on the gear re-rendered the whole of App (map, markers, squad panel, tab bar) before
// Settings could show. Now only what reads it re-renders: the Settings layer and the two
// places the Emergency button can stand.
let open = false;
const listeners = new Set();

export const isSettingsOpen = () => open;

export function setSettingsOpen(next) {
  if (open === next) return;
  open = next;
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useSettingsOpen = () => useSyncExternalStore(subscribe, isSettingsOpen, isSettingsOpen);
