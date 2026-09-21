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

// --- SOS lifecycle -----------------------------------------------------------
// An SOS is remembered on its squad (squad.sos, keyed by sender) until it expires,
// so a member who was offline when it fired can be caught up when they're back in
// the room. Everything is in memory, like the rest of the server: a restart drops it.

// Record a new SOS from `senderKey`. A sender re-triggering replaces their previous
// SOS (fresh id, acknowledgements reset) — the newest beacon is the one that matters.
export function recordSos(squad, { senderKey, senderId, senderName, lat, lng, timestamp }, now = Date.now()) {
  squad.sos = squad.sos || {};
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
  };
  squad.sos[senderKey] = sos;
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
  };
}

// SOS entries `memberKey` still owes an acknowledgement for, oldest first: not their
// own, not already acknowledged by them, not expired. Expired entries are dropped.
export function pendingSosFor(squad, memberKeyValue, now = Date.now()) {
  if (!squad?.sos) return [];
  const pending = [];
  for (const [key, sos] of Object.entries(squad.sos)) {
    if (now - sos.createdAt > SOS_TTL_MS) {
      delete squad.sos[key];
      continue;
    }
    if (sos.senderKey === memberKeyValue) continue;
    if (sos.ackedBy.includes(memberKeyValue)) continue;
    pending.push(sos);
  }
  return pending.sort((a, b) => a.createdAt - b.createdAt);
}

// Mark `sosId` as acknowledged by `memberKeyValue`. Returns false if there's no such
// live SOS in this squad (already replaced, expired, or a made-up id).
export function ackSos(squad, sosId, memberKeyValue) {
  const sos = Object.values(squad?.sos ?? {}).find((s) => s.id === sosId);
  if (!sos) return false;
  if (!sos.ackedBy.includes(memberKeyValue)) sos.ackedBy.push(memberKeyValue);
  return true;
}
