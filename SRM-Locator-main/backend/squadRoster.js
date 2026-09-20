// Durable squad membership, keyed by stable identity (Firebase uid) rather than by
// socket id.
//
// Why: a socket id lives exactly as long as one connection. On mobile that's not long —
// a signal blip or a backgrounded app mints a brand-new socket id on reconnect. When
// "is this person already in the squad?" was answered by socket id, every reconnecting
// member looked like a stranger and was dropped back into the Commander's approval
// queue, even though the Commander had already approved them. `squad.members` can't
// answer it either: the periodic stale sweep prunes dead socket ids from it, so it
// forgets a member who's been offline for a minute.
//
// So each squad carries `knownUids`: the people who've been admitted (by the Commander,
// or as owner) and haven't since left, been kicked, or been blocked. It is only ever
// added to on admission and removed from on a deliberate exit — never by a disconnect.
//
// Trust note: the uid arrives in the client's own 'request-join' payload and isn't
// verified against Firebase server-side (the owner-reconnect path already relies on the
// same claim). Anyone who learns a member's uid and the squad code could present it.
// uids aren't broadcast to other clients, but verifying the Firebase ID token on the
// server would be the proper hardening.

export const isKnownMember = (squad, uid) =>
  Boolean(uid) && Boolean(squad?.knownUids?.includes(uid));

// Record `uid` as an admitted member. No-op without a uid.
export function rememberMember(squad, uid) {
  if (!uid) return;
  squad.knownUids = squad.knownUids || [];
  if (!squad.knownUids.includes(uid)) squad.knownUids.push(uid);
}

// Forget `uid` — they must be approved again to come back.
export function forgetMember(squad, uid) {
  if (!uid || !squad?.knownUids) return;
  squad.knownUids = squad.knownUids.filter((known) => known !== uid);
}

// Readmit a previously approved member arriving on a new socket, with no approval step.
//
// Moves them from whatever socket(s) they used before onto `socketId`: the stale ids
// leave `members`/`memberUids`, the new one joins. If one of the stale sockets was the
// squad's owner (a member who'd been promoted when the Commander left), ownership moves
// with them — otherwise they'd come back as a plain member of a squad whose "owner" is a
// dead socket.
//
// Returns null if this isn't a known member (caller falls through to normal approval);
// otherwise { role, staleIds } so the caller can detach the old sockets and clear their
// per-socket state.
export function rebindReturningMember(squad, { uid, socketId }) {
  if (!isKnownMember(squad, uid)) return null;

  squad.memberUids = squad.memberUids || {};
  const staleIds = Object.keys(squad.memberUids).filter(
    (id) => id !== socketId && squad.memberUids[id] === uid
  );

  const wasOwner = staleIds.includes(squad.ownerId);

  squad.members = squad.members.filter((id) => !staleIds.includes(id));
  if (!squad.members.includes(socketId)) squad.members.push(socketId);

  staleIds.forEach((id) => delete squad.memberUids[id]);
  squad.memberUids[socketId] = uid;

  if (wasOwner) {
    squad.ownerId = socketId;
    squad.ownerUid = uid;
  }

  return { role: wasOwner ? 'OWNER' : 'MEMBER', staleIds };
}
