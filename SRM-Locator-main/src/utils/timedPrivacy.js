// Timed Pause and Hidden, the app's side (Stage 4). The server keeps each Pause or Hidden as a hold
// with an end time and ends it itself (backend/sharingHolds.js); the app asks for one, shows the
// countdown by the server's clock, and follows the server when it ends.
//
// Off (TIMED_PRIVACY_ENABLED false), Pause and Hidden are exactly as in js-1.1.87: chosen here, no
// time limit. On, and the server answering 'disabled' (its own switch off), the app falls back to
// the same old behaviour, so the app and the server can be released in either order.

/** The app's switch. Off until the server's LOCUS_TIMED_PRIVACY_ENABLED is on in production. */
export const TIMED_PRIVACY_ENABLED = false;

/** The longest one Pause or Hidden may be asked for (the server's MAX_HOLD_MINUTES). */
export const MAX_HOLD_MINUTES = 30;
/** The heads-up before a hold ends: "You'll be visible again at HH:MM". */
export const HEADS_UP_BEFORE_MS = 2 * 60 * 1000;
/** The durations offered, in minutes, up to what is left. */
export const HOLD_DURATIONS_MIN = [5, 10, 15, 20, 30];
/** How long to wait for the server's answer before saying it could not be reached. */
export const HOLD_REQUEST_TIMEOUT_MS = 8000;
/** A hold whose end the server has not reported this long after its end time is ended here. */
export const HOLD_END_GRACE_MS = 5000;

const MINUTE = 60 * 1000;

/** Whole minutes in `ms`, rounded down, never below 0. */
export const wholeMinutes = (ms) => Math.max(0, Math.floor((Number(ms) || 0) / MINUTE));

/**
 * The durations to offer when `allowanceLeftMs` is left (unknown: as if the full allowance were).
 * Each offered duration is at most MAX_HOLD_MINUTES and at most what is left; when what is left is
 * not one of the usual ones, it is offered too, so all of it can be used.
 */
export function durationChoices(allowanceLeftMs) {
  const cap = allowanceLeftMs == null ? MAX_HOLD_MINUTES : Math.min(MAX_HOLD_MINUTES, wholeMinutes(allowanceLeftMs));
  if (cap < 1) return [];
  const choices = HOLD_DURATIONS_MIN.filter((m) => m <= cap);
  if (!choices.includes(cap)) choices.push(cap);
  return choices;
}

/** The server's clock minus the phone's, from a reply carrying `serverNow` received at `receivedAt`. */
export const clockOffset = (serverNow, receivedAt = Date.now()) => (Number.isFinite(serverNow) ? serverNow - receivedAt : 0);

/** The time on the server's clock now, given the offset. */
export const serverTime = (offset, now = Date.now()) => now + (offset || 0);

/** Milliseconds left of a hold ending at `until` (server clock), never below 0. */
export const msLeft = (until, offset, now = Date.now()) => Math.max(0, until - serverTime(offset, now));

/**
 * When to show the heads-up for a hold ending at `until`: ms from now. A hold with less than
 * HEADS_UP_BEFORE_MS left (a short one, or one found again on reopening) shows it at once.
 */
export const headsUpDelayMs = (until, offset, now = Date.now()) => Math.max(0, msLeft(until, offset, now) - HEADS_UP_BEFORE_MS);

/** "14:05": a server-clock time shown in the phone's own clock and its own 12/24-hour style. */
export function clockLabel(serverEpoch, offset = 0) {
  if (!Number.isFinite(serverEpoch)) return '';
  return new Date(serverEpoch - (offset || 0)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "12:34": minutes and seconds left. */
export function countdownLabel(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The minutes "Hide again" asks for: what the server says is left plus what the running hold has
 * not used yet (it is given back when the new hold replaces it), at most MAX_HOLD_MINUTES. 0 when
 * nothing is left, and then no button is shown.
 */
export function hideAgainMinutes(allowanceLeftMs, runningLeftMs = 0) {
  if (!(allowanceLeftMs > 0)) return 0;
  return Math.min(MAX_HOLD_MINUTES, wholeMinutes(allowanceLeftMs + Math.max(0, runningLeftMs)));
}

// The server's clock offset, as last learned from a reply (useTimedPrivacy), for showing other
// members' "until" times in this phone's clock. 0 until one has come.
let lastOffset = 0;
export const rememberServerOffset = (offset) => { lastOffset = Number.isFinite(offset) ? offset : 0; };
export const serverOffset = () => lastOffset;
