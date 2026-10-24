import { useSyncExternalStore } from 'react';
import { shareInAppDnd } from './alertSound';

// LOCUS's own Do Not Disturb, on this phone (Settings > Notifications): pings arrive silently,
// without sound or vibration, and still show in the app; an SOS rings whatever it says, because
// safety comes first. Kept on the phone only (the server sends pings as before), and handed to
// native code so a ping notification raised while the app is closed can stay quiet too.

export const IN_APP_DND_KEY = 'locus.inAppDnd';

const storage = () => {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

let on = (() => {
  try {
    return storage()?.getItem(IN_APP_DND_KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set();

export const isInAppDnd = () => on;

export function setInAppDnd(next) {
  const value = Boolean(next);
  if (value === on) return;
  on = value;
  try {
    if (value) storage()?.setItem(IN_APP_DND_KEY, '1');
    else storage()?.removeItem(IN_APP_DND_KEY);
  } catch {
    // Not kept past this run; it still applies now.
  }
  shareInAppDnd(value);
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useInAppDnd = () => useSyncExternalStore(subscribe, isInAppDnd, isInAppDnd);

/** For tests: back to off, as on a fresh install. */
export function __resetInAppDnd() {
  on = false;
  listeners.clear();
}
