// A Group's activity log: when someone went hidden and came back, left, lost their
// connection, or was kicked or blocked. Readable only by the main admin and moderators
// (groupRoles.js, readActivityLog), who can export it as a CSV file from the app.
//
// Kept on the squad, in memory, like everything else on this server: the 5-minute sweep of an
// idle Group and a Render restart both lose it. Nothing else goes in: no positions, ever.

// The most entries one Group keeps; the oldest go first.
export const ACTIVITY_LOG_MAX_ENTRIES = 300;

export const ACTIVITY = Object.freeze({
  WENT_HIDDEN: 'went-hidden',
  BACK_FROM_HIDDEN: 'back-from-hidden',
  WENT_PAUSED: 'went-paused', // only logged while timed Pause and Hidden are on (sharingHolds.js)
  BACK_FROM_PAUSED: 'back-from-paused',
  LEFT: 'left-group', // a deliberate Leave
  CONNECTION_LOST: 'connection-lost', // the connection dropped; not a decision to leave
  KICKED: 'kicked',
  BLOCKED: 'blocked',
  UNBLOCKED: 'unblocked',
});
const KINDS = new Set(Object.values(ACTIVITY));

const clean = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : null);

/**
 * Adds one entry: { at, kind, uid, name, byUid?, byName? } (`by` is who kicked, blocked or
 * unblocked). Returns the entry, or null for an unknown kind.
 */
export function logActivity(squad, { at = Date.now(), kind, uid, name, byUid, byName } = {}) {
  if (!squad || !KINDS.has(kind)) return null;
  const entry = { at, kind, uid: clean(uid, 128), name: clean(name, 60) };
  if (byUid || byName) {
    entry.byUid = clean(byUid, 128);
    entry.byName = clean(byName, 60);
  }
  squad.activityLog = squad.activityLog || [];
  squad.activityLog.push(entry);
  if (squad.activityLog.length > ACTIVITY_LOG_MAX_ENTRIES) {
    squad.activityLog.splice(0, squad.activityLog.length - ACTIVITY_LOG_MAX_ENTRIES);
  }
  return entry;
}

export const activityOf = (squad) => [...(squad?.activityLog ?? [])];

/**
 * Notes the sharing mode `status` a person reported. Returns the entry to log for going hidden
 * or coming back (not yet logged: the caller logs it, see recordActivity in server.js), or null
 * when nothing changed.
 */
export function noteSharingMode(squad, { uid, name, status, at = Date.now() }) {
  if (!squad || !uid) return null;
  squad.hiddenUids = squad.hiddenUids || [];
  const wasHidden = squad.hiddenUids.includes(uid);
  const isHidden = status === 'GHOST';
  if (isHidden === wasHidden) return null;
  if (isHidden) squad.hiddenUids.push(uid);
  else squad.hiddenUids = squad.hiddenUids.filter((h) => h !== uid);
  return { at, kind: isHidden ? ACTIVITY.WENT_HIDDEN : ACTIVITY.BACK_FROM_HIDDEN, uid, name };
}

/**
 * The same for Paused (status 'FROZEN'): the entry for pausing or coming back from a pause, or
 * null when nothing changed. Kept apart from Hidden, so going from Paused straight to Hidden logs
 * both "back from paused" and "went hidden".
 */
export function notePausedMode(squad, { uid, name, status, at = Date.now() }) {
  if (!squad || !uid) return null;
  squad.pausedUids = squad.pausedUids || [];
  const wasPaused = squad.pausedUids.includes(uid);
  const isPaused = status === 'FROZEN';
  if (isPaused === wasPaused) return null;
  if (isPaused) squad.pausedUids.push(uid);
  else squad.pausedUids = squad.pausedUids.filter((p) => p !== uid);
  return { at, kind: isPaused ? ACTIVITY.WENT_PAUSED : ACTIVITY.BACK_FROM_PAUSED, uid, name };
}

/** Someone gone from the Group is no longer "hidden" or "paused": coming back starts afresh. */
export function forgetSharingMode(squad, uid) {
  if (squad?.hiddenUids) squad.hiddenUids = squad.hiddenUids.filter((h) => h !== uid);
  if (squad?.pausedUids) squad.pausedUids = squad.pausedUids.filter((p) => p !== uid);
}
