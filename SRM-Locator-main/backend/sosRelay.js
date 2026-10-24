import { randomUUID } from 'node:crypto';

// How long an unacknowledged SOS keeps being replayed to members who were offline
// (or between sockets) when it fired. Long enough to cover a dead zone or an app
// restart; short enough that a long-resolved incident doesn't greet someone who
// joins the squad hours later.
export const SOS_TTL_MS = 30 * 60 * 1000;

// Which squad room an incoming 'sos-broadcast' belongs to, or null if the sender
// isn't a member of any squad.
//
// The authoritative source is the squad roster (activeSquads[room].members), which
// is written at join/approval time. The `users` map is NOT: it's only populated by
// 'update-location', i.e. after the client has a GPS fix. Keying SOS off `users`
// meant a member with no fix yet (permission denied, indoors, just joined) had
// their distress beacon silently dropped while their button still said "SOS SENT".
//
// The client-claimed room is only honoured if the roster confirms the sender is in
// it, so it can't be used to broadcast into a squad the sender doesn't belong to.
export function resolveSosRoom(activeSquads, users, socketId, claimedRoomCode) {
  const isMemberOf = (room) =>
    typeof room === 'string' && Boolean(activeSquads[room]?.members?.includes(socketId));

  const recorded = users[socketId]?.roomCode;
  if (isMemberOf(recorded)) return recorded;
  if (isMemberOf(claimedRoomCode)) return claimedRoomCode;

  return Object.keys(activeSquads).find(isMemberOf) ?? null;
}

// The squad room two sockets are both on the roster of, or null if there is none.
// Gates the single-target member ping, which carries no room of its own: without it
// the server relayed to any socket id it was handed, from anyone — and io.to() also
// accepts a room code, so a "target" could be an entire squad.
export function sharedSquad(activeSquads, socketIdA, socketIdB) {
  if (typeof socketIdA !== 'string' || typeof socketIdB !== 'string') return null;
  return Object.keys(activeSquads).find((room) => {
    const members = activeSquads[room]?.members;
    return Boolean(members?.includes(socketIdA) && members.includes(socketIdB));
  }) ?? null;
}

// Identity used to track who sent / acknowledged an SOS. The Firebase uid when we
// have one, because it survives a reconnect (which mints a new socket id) — that's
// what lets an acknowledgement stick across reconnects. Socket id is the fallback.
export const memberKey = (uid, socketId) => uid || socketId;

// Every SOS carries `rev`, a counter that only goes up within its squad and moves again whenever
// that SOS is created or updated. A phone listening from the background (the long poll in
// backgroundSharing.js) has no socket to be pushed to: it asks for what is newer than the last
// `rev` it saw. Never sent on the socket (toSosPayload leaves it out).
const stamp = (squad, sos) => {
  squad.sosRev = (squad.sosRev ?? 0) + 1;
  sos.rev = squad.sosRev;
};

// --- SOS lifecycle -----------------------------------------------------------
// An SOS is remembered on its squad (squad.sos, keyed by sender) until it expires,
// so a member who was offline when it fired can be caught up when they're back in
// the room. Everything is in memory, like the rest of the server: a restart drops it.

// Record a new SOS from `senderKey`. A sender re-triggering replaces their previous
// SOS (fresh id, acknowledgements reset) — the newest beacon is the one that matters.
//
// The store has no prototype because senderKey is the client-sent uid: on a plain {},
// a uid of '__proto__' replaced the prototype instead of adding an entry, so the SOS
// went out live but was never replayed or acknowledgeable.
//
// `audience` is who may hear it (friends.js sosAudience: member keys), or null for everyone in the
// Group. It decides the live relay, the catch-up (pendingSosFor) and the closed-app poll alike.
export function recordSos(squad, { senderKey, senderId, senderName, lat, lng, timestamp, flag, audience = null }, now = Date.now()) {
  squad.sos = squad.sos || Object.create(null);
  const sos = {
    id: randomUUID(),
    senderKey,
    senderId,
    senderName: senderName ?? null,
    lat: lat ?? null,
    lng: lng ?? null,
    timestamp: timestamp || now,
    createdAt: now,
    ackedBy: [],
    // Why the server flagged it (alertRules.js): 'QUIET_ZONE' or 'LOCATION_UNKNOWN'.
    flag: flag ?? null,
    audience: audience ? [...audience] : null,
  };
  stamp(squad, sos);
  squad.sos[senderKey] = sos;
  return sos;
}

// A sender pressing again while their earlier SOS is still fresh updates that SOS rather
// than starting another: same id, so no second alarm anywhere, and nobody who already
// acknowledged it is asked again. Its location and time become the newest. Returns the
// updated SOS, or null when there is none fresh enough, in which case the caller records
// a new one (and that is the alarm).
export function coalesceSos(squad, { senderKey, senderId, lat, lng, timestamp, flag, audience = null }, now, windowMs) {
  const sos = squad?.sos?.[senderKey];
  if (!sos || now - sos.createdAt >= windowMs) return null;
  sos.senderId = senderId;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    sos.lat = lat;
    sos.lng = lng;
  }
  sos.timestamp = timestamp || now;
  if (flag) sos.flag = flag;
  sos.audience = audience ? [...audience] : null;
  stamp(squad, sos);
  return sos;
}

// What goes over the wire. `ageMs` is measured on the server so a replayed alert can
// say how old it is without trusting either phone's clock (0 for a live broadcast).
export function toSosPayload(sos, now = Date.now()) {
  return {
    id: sos.id,
    senderId: sos.senderId,
    senderName: sos.senderName,
    lat: sos.lat,
    lng: sos.lng,
    timestamp: sos.timestamp,
    ageMs: Math.max(0, now - sos.createdAt),
    // Only when the server flagged it, so an ordinary SOS is byte-for-byte what it was.
    ...(sos.flag ? { flag: sos.flag } : {}),
  };
}

/** Whether the person `memberKeyValue` may hear this SOS (its audience, or everyone). */
export const mayHear = (sos, memberKeyValue) => !sos.audience || sos.audience.includes(memberKeyValue);

// SOS entries `memberKey` still owes an acknowledgement for, oldest first: not their
// own, ones they may hear, not already acknowledged by them, not expired. Expired entries are dropped.
export function pendingSosFor(squad, memberKeyValue, now = Date.now()) {
  if (!squad?.sos) return [];
  const pending = [];
  for (const [key, sos] of Object.entries(squad.sos)) {
    if (now - sos.createdAt > SOS_TTL_MS) {
      delete squad.sos[key];
      continue;
    }
    if (sos.senderKey === memberKeyValue) continue;
    if (!mayHear(sos, memberKeyValue)) continue;
    if (sos.ackedBy.includes(memberKeyValue)) continue;
    pending.push(sos);
  }
  return pending.sort((a, b) => a.createdAt - b.createdAt);
}

// What a phone listening from the background is told about one SOS (backgroundSharing.js). The same
// facts the socket carries, plus the sender's stable key (the Firebase uid: the socket id changes
// on every reconnect, and a second press from the same person must replace the first alert) and
// the `rev` to resume from.
export function toBackgroundSosPayload(sos, now = Date.now()) {
  return { ...toSosPayload(sos, now), senderUid: sos.senderKey, rev: sos.rev };
}

// SOS entries newer than `after` that `memberKeyValue` still owes an acknowledgement for.
export function pendingSosSince(squad, memberKeyValue, after, now = Date.now()) {
  return pendingSosFor(squad, memberKeyValue, now).filter((sos) => (sos.rev ?? 0) > after);
}

// Mark `sosId` as acknowledged by `memberKeyValue`. Returns false if there's no such
// live SOS in this squad (already replaced, expired, or a made-up id).
export function ackSos(squad, sosId, memberKeyValue) {
  const sos = Object.values(squad?.sos ?? {}).find((s) => s.id === sosId);
  if (!sos) return false;
  if (!sos.ackedBy.includes(memberKeyValue)) sos.ackedBy.push(memberKeyValue);
  return true;
}
