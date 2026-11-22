// Timed Pause and Hidden, kept on the server (Stage 1 of Nearby Join and timed privacy).
//
// A member picks Paused or Hidden for a number of minutes. The server keeps that choice as a
// *hold* on the person's account (Firebase uid), not on a connection or a phone: restarting the
// app, reconnecting, or leaving and joining again finds the same hold with the same end time.
// When the time is up the server ends the hold itself (expire, called by a sweep in server.js)
// and the phone is told. An SOS ends it too.
//
// Each hold is at most MAX_HOLD_MINUTES long, and Pause plus Hidden together may take at most
// HOLD_ALLOWANCE_MINUTES of any rolling HOLD_WINDOW_MINUTES. Time held counts as used the moment
// it is held, so pausing and resuming for a second costs a second and never resets anything.
//
// A request for more than is left is refused (with what is left), never shortened: the member
// chose a duration, and the app offers what is left instead.
//
// Only Pause and Hidden are holds. Live is "no hold". Pure logic: the caller passes the time.

export const MAX_HOLD_MINUTES = 30; // the longest one Pause or Hidden may be asked for
export const HOLD_ALLOWANCE_MINUTES = 30; // Pause + Hidden allowed in any rolling window ...
export const HOLD_WINDOW_MINUTES = 60; // ... of this many minutes

export const HOLD_MODES = Object.freeze(['FROZEN', 'GHOST']); // Paused, Hidden
export const SHARING_MODES = Object.freeze(['ACTIVE', ...HOLD_MODES]);

// Why a hold ended, as the phone is told.
export const END_REASON = Object.freeze({ EXPIRED: 'expired', RESUMED: 'resumed', SOS: 'sos', REPLACED: 'replaced' });

/**
 * @param {{ minuteMs?: number }} [options] minuteMs: how long a "minute" is (tests shorten it)
 */
export function createHoldStore({ minuteMs = 60_000 } = {}) {
  const maxHoldMs = MAX_HOLD_MINUTES * minuteMs;
  const allowanceMs = HOLD_ALLOWANCE_MINUTES * minuteMs;
  const windowMs = HOLD_WINDOW_MINUTES * minuteMs;

  const holds = new Map(); // uid -> { mode, startedAt, until, spot }
  const used = new Map(); // uid -> [{ start, end }] of finished holds still inside the window

  // Finished holds that no longer reach into the window are forgotten.
  const prune = (uid, now) => {
    const list = (used.get(uid) ?? []).filter((span) => span.end > now - windowMs);
    if (list.length) used.set(uid, list);
    else used.delete(uid);
    return list;
  };

  /** Milliseconds of Pause + Hidden `uid` has held in the window ending at `now`, the running hold included. */
  const usedMs = (uid, now) => {
    const from = now - windowMs;
    let total = 0;
    for (const span of prune(uid, now)) total += Math.max(0, span.end - Math.max(span.start, from));
    const hold = holds.get(uid);
    if (hold) total += Math.max(0, Math.min(now, hold.until) - Math.max(hold.startedAt, from));
    return total;
  };

  /**
   * What `uid` may still start at `now`. While a hold runs, what it has not yet used is not
   * counted as left: it is already spoken for.
   */
  const leftMs = (uid, now) => {
    const hold = holds.get(uid);
    const reserved = hold ? Math.max(0, hold.until - now) : 0;
    return Math.max(0, allowanceMs - usedMs(uid, now) - reserved);
  };

  const finish = (uid, now) => {
    const hold = holds.get(uid);
    if (!hold) return null;
    holds.delete(uid);
    const end = Math.min(now, hold.until);
    if (end > hold.startedAt) used.set(uid, [...prune(uid, now), { start: hold.startedAt, end }]);
    return hold;
  };

  return {
    maxHoldMs,
    allowanceMs,
    windowMs,

    /** The running hold of `uid` at `now`, or null. One that has run out is not running. */
    active(uid, now) {
      const hold = holds.get(uid);
      return hold && hold.until > now ? hold : null;
    },

    leftMs,

    /**
     * Starts a hold of `minutes` in `mode` ('FROZEN' or 'GHOST'). A hold already running ends
     * first (what it used stays used). `spot` is where a Pause holds the person ({ lat, lng }),
     * or null. Returns { ok: true, hold, ended } or { ok: false, reason, leftMs }:
     * 'bad-mode', 'bad-minutes', or 'allowance' (asked for more than is left).
     */
    start(uid, { mode, minutes, spot = null }, now) {
      if (!HOLD_MODES.includes(mode)) return { ok: false, reason: 'bad-mode', leftMs: leftMs(uid, now) };
      if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_HOLD_MINUTES) {
        return { ok: false, reason: 'bad-minutes', leftMs: leftMs(uid, now) };
      }
      const durationMs = Math.round(minutes * minuteMs);
      // Checked as if the running hold ended now: switching from Pause to Hidden, or asking
      // again, is a new hold, paid for from what is left.
      const runningLeftAfterEnd = Math.max(0, allowanceMs - usedMs(uid, now));
      if (durationMs > runningLeftAfterEnd) return { ok: false, reason: 'allowance', leftMs: runningLeftAfterEnd };
      const ended = finish(uid, now);
      const hold = { mode, startedAt: now, until: now + durationMs, spot: mode === 'FROZEN' ? spot : null };
      holds.set(uid, hold);
      return { ok: true, hold, ended };
    },

    /** Ends `uid`'s hold now (Live chosen, or an SOS). Returns the hold that ended, or null. */
    end(uid, now) {
      return finish(uid, now);
    },

    /** Ends every hold that has run out by `now`. Returns [{ uid, hold }]. */
    expire(now) {
      const ended = [];
      for (const [uid, hold] of [...holds]) {
        if (hold.until <= now) {
          finish(uid, now);
          ended.push({ uid, hold });
        }
      }
      return ended;
    },

    /** How many people hold something now (for tests and logs). */
    size: () => holds.size,
  };
}

/** The `minuteMs` the server should use: the test override only outside production. */
export function holdMinuteMs(env = process.env) {
  const override = Number(env.LOCUS_HOLD_MINUTE_MS);
  if (!Number.isFinite(override) || override <= 0) return 60_000;
  if (env.NODE_ENV === 'production') return 60_000;
  return override;
}

/** Whether timed Pause and Hidden are on. Off unless LOCUS_TIMED_PRIVACY_ENABLED is "true". */
export const timedPrivacyEnabled = (env = process.env) => env.LOCUS_TIMED_PRIVACY_ENABLED === 'true';
