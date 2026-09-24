// The comms feed: in-app notifications that replace window.alert(). An alert() is a native
// dialog that freezes the whole WebView until it's dismissed - timers, sockets, the map,
// and an incoming SOS alarm included - and it looks like a browser error, not part of LOCUS.
//
// A tiny module-level store, so anything can post without prop-drilling: the sign-in screen,
// the AR compass, socket handlers. <CommsFeed /> (src/components/CommsFeed.jsx) renders it.
//
//   notify.error('ID AND KEY ARE REQUIRED FOR LINK.');
//   notify.success('ROUTE PUBLISHED', { title: 'RALLY_NET' });

import { haptic } from './haptics.js';

export const SEVERITIES = ['info', 'success', 'warning', 'error'];

/** How long each severity stays up, in ms. Errors linger: they usually need reading. */
export const DURATIONS = { info: 4000, success: 3500, warning: 6000, error: 7000 };

/** At most this many at once; the oldest goes first. */
export const MAX_VISIBLE = 4;

const HAPTICS = { info: 'tick', success: 'confirm', warning: 'snap', error: 'snap' };

let items = [];
let nextId = 1;
const listeners = new Set();
const timers = new Map();

const emit = () => listeners.forEach((fn) => fn(items));

export function subscribe(fn) {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}

export function dismiss(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const before = items.length;
  items = items.filter((n) => n.id !== id);
  if (items.length !== before) emit();
}

/**
 * Posts a notification and returns its id.
 * @param {'info'|'success'|'warning'|'error'} severity
 * @param {string} message
 * @param {{title?: string, duration?: number}} [options] duration 0 = stays until dismissed
 */
export function post(severity, message, { title: givenTitle, duration } = {}) {
  let title = givenTitle;
  const level = SEVERITIES.includes(severity) ? severity : 'info';
  let text = String(message ?? '').trim();
  // The app's messages carry their own tag ("[SYS_ERROR] ...", "[RECOVERY_DISPATCHED] ...");
  // it becomes the notice's title rather than being repeated in the body.
  const tag = /^\[([A-Z0-9_ ]+)\]\s*/.exec(text);
  if (tag && !title) {
    title = tag[1].trim();
    text = text.slice(tag[0].length).trim();
  }
  if (!text) return null;

  // The same message already up (a button mashed, a handler firing twice): refresh its
  // timer instead of stacking copies of it.
  const twin = items.find((n) => n.severity === level && n.message === text && n.title === title);
  const life = duration ?? DURATIONS[level];
  if (twin) {
    clearTimeout(timers.get(twin.id));
    if (life > 0) timers.set(twin.id, setTimeout(() => dismiss(twin.id), life));
    items = items.map((n) => (n.id === twin.id ? { ...n, postedAt: Date.now(), duration: life } : n));
    emit();
    return twin.id;
  }

  const id = nextId++;
  items = [...items, { id, severity: level, title, message: text, postedAt: Date.now(), duration: life }];
  while (items.length > MAX_VISIBLE) dismiss(items[0].id);
  if (life > 0) timers.set(id, setTimeout(() => dismiss(id), life));
  haptic(HAPTICS[level]);
  emit();
  return id;
}

export const notify = {
  info: (message, options) => post('info', message, options),
  success: (message, options) => post('success', message, options),
  warning: (message, options) => post('warning', message, options),
  error: (message, options) => post('error', message, options),
};

/** Tests only: start from an empty feed. */
export function __resetNotifications() {
  timers.forEach(clearTimeout);
  timers.clear();
  items = [];
  nextId = 1;
  emit();
}
