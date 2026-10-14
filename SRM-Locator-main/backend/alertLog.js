// What the server remembers about SOS and Ping use inside one Group, on the squad object:
// the log the Group Lead can read, each sender's recent pings (for the cooldown), and each
// sender's recent SOS (to tell the Group Lead about repeats). All in memory, like the rest
// of the squad, and gone with it.

/** Appends one decision to the Group's log, keeping the newest `size`. Returns the entry. */
export function logAlert(squad, entry, size) {
  squad.alertLog = squad.alertLog || [];
  squad.alertLog.push(entry);
  if (squad.alertLog.length > size) squad.alertLog.splice(0, squad.alertLog.length - size);
  return entry;
}

// Keyed by client-supplied identity, so no prototype (see recordSos).
const table = (squad, name) => (squad[name] = squad[name] || Object.create(null));

/** The sender's allowed pings still inside `windowMs`: { lastToTargetAt, recentAts }. */
export function pingHistory(squad, senderKey, targetKey, now, windowMs) {
  const list = (table(squad, 'pingHistory')[senderKey] || []).filter((p) => now - p.at < windowMs);
  const toTarget = list.filter((p) => p.targetKey === targetKey);
  return {
    lastToTargetAt: toTarget.length ? toTarget[toTarget.length - 1].at : null,
    recentAts: list.map((p) => p.at),
  };
}

/** Remembers an allowed ping, and forgets this sender's ones that have aged out. */
export function recordPing(squad, senderKey, targetKey, now, windowMs) {
  const kept = (table(squad, 'pingHistory')[senderKey] || []).filter((p) => now - p.at < windowMs);
  kept.push({ at: now, targetKey });
  squad.pingHistory[senderKey] = kept;
}

/**
 * Counts an SOS from `senderKey`. Returns { count, flag }: how many they have sent within
 * `windowMs` (this one included), and whether the Group Lead should now be told they are
 * sending repeatedly: true once the count reaches `flagCount`, and then at most once per
 * window, so a person holding the button down raises one notice, not a stream.
 */
export function noteSosAttempt(squad, senderKey, now, windowMs, flagCount) {
  const state = table(squad, 'sosAttempts')[senderKey] || { ats: [], flaggedAt: null };
  state.ats = state.ats.filter((at) => now - at < windowMs);
  state.ats.push(now);
  let flag = false;
  if (state.ats.length >= flagCount && (state.flaggedAt === null || now - state.flaggedAt >= windowMs)) {
    state.flaggedAt = now;
    flag = true;
  }
  squad.sosAttempts[senderKey] = state;
  return { count: state.ats.length, flag };
}
