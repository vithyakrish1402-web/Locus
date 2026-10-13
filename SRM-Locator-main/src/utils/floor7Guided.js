// The guided Floor 7 walk test: the pure parts. Which doors, in what order, where the person is
// in the walk, what the status line says, whether the ready check is satisfied, and how a
// result is described. The screens (src/components/devmode/) only draw these. Nothing here
// touches the recorder's files, the filter or any constant.

import planDoc from '../../floor7-inputs/floor7_plan.json';
import { PLAN_SCALE, floor7Plan } from './floor7Plan.js';

/** The doors of the walk, by plan place id. Room 701 first: the walk starts there. */
export const TOUR_PLACES = ['r701', 'r702', 'r703', 'r703A', 'rNew', 'rW', 'labD', 'labC', 'dept1', 'rM', 'rL', 'r704', 'r705', 'r706', 'r706A'];
/** The ends of the middle passage for the continuous walk: the west and east lift lobbies. */
export const PASSAGE = { from: 'lobbyA', to: 'lobbyB' };
/** Up to this many doors the shortest route is found exactly; more are ordered nearest-first. */
export const EXACT_TOUR_MAX = 16;

const placeOf = (id) => planDoc.places.find((p) => p.id === id);
export const placeName = (id) => placeOf(id)?.name ?? id;
const front = (id) => {
  const p = placeOf(id);
  return { x: p.front_point[0] * PLAN_SCALE, y: p.front_point[1] * PLAN_SCALE };
};

/**
 * The shortest walk through all `ids`, starting at `startId`, on foot along the corridors
 * (the plan's own walking distance). Exact (Held-Karp) up to EXACT_TOUR_MAX places.
 * @returns {string[]} ids in walking order, `startId` first
 */
export function shortestTour(startId, ids, walk = (a, b) => floor7Plan.walkingDistance(front(a), front(b))) {
  const rest = ids.filter((id) => id !== startId);
  if (rest.length === 0) return [startId];
  const pts = [startId, ...rest];
  const n = rest.length;
  const d = pts.map((a) => pts.map((b) => walk(a, b)));
  if (n + 1 > EXACT_TOUR_MAX) {
    const order = [0];
    const left = new Set(rest.map((_, i) => i + 1));
    while (left.size) {
      const here = order.at(-1);
      const next = [...left].reduce((best, j) => (d[here][j] < d[here][best] ? j : best));
      order.push(next);
      left.delete(next);
    }
    return order.map((i) => pts[i]);
  }
  // cost[mask][j]: shortest walk from the start through the places in mask, ending at j (1-based).
  const full = (1 << n) - 1;
  const cost = Array.from({ length: full + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const from = Array.from({ length: full + 1 }, () => new Int8Array(n + 1).fill(-1));
  for (let j = 1; j <= n; j++) cost[1 << (j - 1)][j] = d[0][j];
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 1; j <= n; j++) {
      if (!(mask & (1 << (j - 1))) || cost[mask][j] === Infinity) continue;
      for (let k = 1; k <= n; k++) {
        if (mask & (1 << (k - 1))) continue;
        const next = mask | (1 << (k - 1));
        const c = cost[mask][j] + d[j][k];
        if (c < cost[next][k]) { cost[next][k] = c; from[next][k] = j; }
      }
    }
  }
  let end = 1;
  for (let j = 2; j <= n; j++) if (cost[full][j] < cost[full][end]) end = j;
  const out = [];
  for (let mask = full, j = end; j > 0;) {
    out.push(pts[j]);
    const prev = from[mask][j];
    mask &= ~(1 << (j - 1));
    j = prev;
  }
  return [startId, ...out.reverse()];
}

/** Total walk of an ordered list of place ids, in metres. */
export const tourLength = (ids) => ids.slice(1).reduce((sum, id, i) => sum + floor7Plan.walkingDistance(front(ids[i]), front(id)), 0);

// ------------------------------------------------------------------ where the person is

/**
 * phase: 'door' (walk to the next door, then tap I'm here), 'dwell' (stand still),
 * 'passage' (the continuous walk: Start of walk), 'walking' (End of walk), 'finished'.
 * `doors` is the route the person confirmed; `index` the current door; `history` for Undo.
 */
export const startWalk = (doors) => ({ doors, index: 0, phase: doors.length ? 'door' : 'passage', history: [], done: [], skipped: [], markedLast: false });

// Steps that create a mark (or skip a door) can be undone; they remember the state before them.
const step = (s, next, markedLast) => ({ ...next, markedLast, history: [...s.history, { ...s, history: undefined }] });
const moveOn = (s) => (s.index + 1 < s.doors.length ? { ...s, index: s.index + 1, phase: 'door' } : { ...s, index: s.doors.length, phase: 'passage' });

/** I'm here: the recorder marks the door (the caller does that); the countdown starts. */
export const imHere = (s) => (s.phase === 'door' ? step(s, { ...s, phase: 'dwell' }, true) : s);
/** Done / next door, or the countdown ran out. Not a step of its own: Undo takes back the I'm here before it. */
export const doneDoor = (s) => (s.phase === 'dwell' ? moveOn({ ...s, done: [...s.done, s.doors[s.index]] }) : s);
/** Skip this door: nothing is recorded for it. */
export const skipDoor = (s) => (s.phase === 'door' ? step(s, moveOn({ ...s, skipped: [...s.skipped, s.doors[s.index]] }), false) : s);
export const startPassage = (s) => (s.phase === 'passage' ? step(s, { ...s, phase: 'walking' }, true) : s);
export const endPassage = (s) => (s.phase === 'walking' ? step(s, { ...s, phase: 'finished' }, true) : s);
/** Undo last: back to the state before the last step. `removesMark` says the recorder's last mark must go too. */
export function undo(s) {
  if (!s.history.length) return { state: s, removesMark: false };
  return { state: { ...s.history.at(-1), history: s.history.slice(0, -1) }, removesMark: s.markedLast };
}

/** "Door 3 of 14" counts the doors the person chose to walk. */
export const progress = (s) => ({ at: Math.min(s.index + 1, s.doors.length), of: s.doors.length });

// ------------------------------------------------------------------ the words

const STALE_S = 90;

/** One plain sentence about what the app is doing right now. */
export function plainStatus({ last, leftScreen, now }) {
  if (leftScreen) return 'The app left the screen, so readings may be slower. Come back and keep the screen on.';
  if (!last) return 'Waiting for the first position.';
  const age = Math.round((now - last.at) / 1000);
  if (age > STALE_S) return `No new reading for ${age} s. Readings come about every 35 s.`;
  if (last.status === 'rejected') return 'Ignored one jumpy reading. Your last good position is still shown.';
  if (last.status === 'reacquiring') return 'Lost you for a moment and found you again.';
  if (!last.filtered) return 'Waiting for a second reading that agrees before showing a position.';
  return 'Position shown.';
}

/** The ready check: each item has a label, whether it is ticked, and what to do if it is not. */
export function readyItems({ inGroup, cycle, trail, now, waitingSince }) {
  const code = cycle?.outcome === 'scan-error' ? cycle.error : null;
  const scanning = Boolean(cycle) && cycle.outcome !== 'scan-error';
  const lastShown = [...trail].reverse().find((t) => t.filtered);
  const gotPosition = Boolean(lastShown) && now - lastShown.at < 120_000;
  const items = [
    { id: 'admin', label: 'Signed in as an admin account', short: 'admin sign-in', ok: true, fix: '' },
    { id: 'group', label: 'In a group', short: 'in a group', ok: inGroup, fix: 'Create a group, or join one, from the main screen. Positioning only runs inside a group.' },
    { id: 'location', label: 'Location is on', short: 'Location on', ok: scanning || (Boolean(cycle) && code !== 'LOCATION_OFF'), fix: 'Turn Location on in the phone’s quick settings.' },
    { id: 'permission', label: 'Nearby Wi-Fi permission given', short: 'Wi-Fi permission', ok: scanning || (Boolean(cycle) && code !== 'PERMISSION_DENIED'), fix: 'Allow Location for LOCUS Test in the phone’s app settings.' },
    { id: 'wifi', label: 'Wi-Fi is on', short: 'Wi-Fi on', ok: scanning || (Boolean(cycle) && code !== 'WIFI_OFF'), fix: 'Turn Wi-Fi on. It does not need to be connected.' },
    { id: 'position', label: 'First position received', short: 'first position', ok: gotPosition, fix: '' },
  ];
  // Until the first scan has been tried, the three phone checks cannot be told apart from "not yet".
  for (const i of items) if (['location', 'permission', 'wifi'].includes(i.id) && !cycle) i.ok = false;
  if (!inGroup) for (const i of items) if (i.id !== 'admin' && i.id !== 'group') i.ok = false;
  const position = items.at(-1);
  position.waitingS = position.ok ? 0 : Math.max(0, Math.round((now - waitingSince) / 1000));
  return items;
}

/** Why Start is disabled, in one sentence; '' when everything is ticked. */
export function whyNotReady(items) {
  const missing = items.filter((i) => !i.ok);
  if (!missing.length) return '';
  return `Still needed before Start: ${missing.map((i) => i.short).join(', ')}.`;
}

export const GOOD_M = 5;
export const FAIR_M = 10;
/** The chip for a walking error: green within 5 m, amber 5 to 10 m, red over 10 m, grey for no position. */
export function chipFor(row) {
  if (!row.shown) return { tone: 'none', label: 'No position' };
  if (row.walkM <= GOOD_M) return { tone: 'good', label: 'Good' };
  if (row.walkM <= FAIR_M) return { tone: 'fair', label: 'Fair' };
  return { tone: 'far', label: 'Far off' };
}

const m1 = (v) => `${v.toFixed(v < 10 ? 1 : 0)} m`;

/** "Typical error 3 m. 11 of 14 doors within 5 m. Worst: New ladies restroom, 21 m." */
export function resultsSummary(doorRows) {
  const shown = doorRows.filter((r) => r.shown);
  if (!doorRows.length) return 'No doors were marked, so there is nothing to score.';
  if (!shown.length) return `None of the ${doorRows.length} doors showed a position.`;
  const errs = shown.map((r) => r.walkM).sort((a, b) => a - b);
  const mid = errs.length % 2 ? errs[(errs.length - 1) / 2] : (errs[errs.length / 2 - 1] + errs[errs.length / 2]) / 2;
  const worst = shown.reduce((a, b) => (b.walkM > a.walkM ? b : a));
  const within = shown.filter((r) => r.walkM <= GOOD_M).length;
  const none = doorRows.length - shown.length;
  return `Typical error ${m1(mid)}. ${within} of ${doorRows.length} doors within ${GOOD_M} m. Worst: ${worst.place.replace(/\s*\(.*\)\s*$/, '')}, ${m1(worst.walkM)}.${none ? ` ${none} ${none === 1 ? 'door' : 'doors'} showed no position.` : ''}`;
}

/** Where a place's door is, in real metres (what the plan drawing and the scoring use). */
export const frontOf = front;
