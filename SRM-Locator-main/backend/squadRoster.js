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

// The uid of the squad's own Commander, whose squad it stays while they're away and whom
// a stand-in (a caretaker, or a member promoted meanwhile) hands it back to. ownerUid is
// whoever holds command right now. A squad made before commanderUid existed has only that.
export const commanderOf = (squad) => squad?.commanderUid ?? squad?.ownerUid ?? null;

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
// Every socket id the squad still has on file for `uid`, other than the one they're
// arriving on now. These are superseded connections: the same person's previous
// session(s), which on mobile are routinely still on the roster because a reconnect
// mints a new socket id long before the old one's 'disconnect' fires.
//
// Callers use this to tear the old connections down — leave the room, drop their
// telemetry — so a returning member is one node on everyone's map, not two, and their
// dead socket can't later raise a "signal lost" for someone who is in fact right here.
export function collectStaleSocketIds(squad, uid, socketId) {
  if (!uid || !squad) return [];
  const byUid = Object.keys(squad.memberUids || {}).filter(
    (id) => id !== socketId && squad.memberUids[id] === uid
  );
  // The owner's previous socket isn't always in memberUids (older squads, or an
  // ownership handover), so take it from ownerUid too rather than leaving it behind.
  if (squad.ownerUid === uid && squad.ownerId && squad.ownerId !== socketId && !byUid.includes(squad.ownerId)) {
    byUid.push(squad.ownerId);
  }
  return byUid;
}

export function rebindReturningMember(squad, { uid, socketId }) {
  if (!isKnownMember(squad, uid)) return null;

  squad.memberUids = squad.memberUids || {};
  const staleIds = collectStaleSocketIds(squad, uid, socketId);

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

// --- What a join request means ----------------------------------------------
//
// INITIALIZE and CONNECT used to send the same 'request-join', and the server answered
// every one as "create the squad if the code is free, otherwise join it". So a code
// could reach the wrong squad without two codes ever colliding: a JOIN for a code with no
// live squad (the creator hadn't tapped INITIALIZE yet, or the server had restarted or
// swept it) made the joiner Commander of a new, empty squad, and a CREATE for a live code
// queued the creator for a stranger's approval, or made them its Commander if that
// squad's own Commander was briefly offline.
//
// Requests now carry an intent:
//   'create'  a brand-new squad. Refused if the code is live, unless the requester is
//             already its Commander (their own retry or a duplicate).
//   'join'    an existing squad. Refused if no live squad has the code.
//   anything else (no intent; 'resume')
//             create-or-join, as before. Every build already installed sends no intent,
//             and a Commander's reconnect sends 'resume' so a squad wiped by a server
//             restart comes back under its code.
//
// `isSocketLive` says whether a member's socket is still connected: a squad whose members
// have all dropped off stays on file until the sweep reaches it (up to a minute), and a
// JOIN must not be handed that squad as its caretaker Commander, which is founding a new
// squad by another name. A CREATE is stricter: any squad still on file under the code,
// live or not, counts as taken, so a new squad never inherits another's state.
//
// Returns the event to refuse with ('squad-not-found' | 'squad-code-taken'), or null to
// carry on through the usual cases.
export function refuseJoin(squad, { intent, uid, isSocketLive = () => true }) {
  const members = squad?.members ?? [];
  if (intent === 'join' && !members.some(isSocketLive)) return 'squad-not-found';
  if (intent === 'create' && members.length > 0 && !(uid && (squad.ownerUid === uid || commanderOf(squad) === uid))) {
    return 'squad-code-taken';
  }
  return null;
}

// --- Join requests awaiting the Commander -------------------------------------
//
// The server used to keep no record of these: a request existed only as an
// 'access-request' on the Commander's screen, and 'resolve-access' admitted whatever
// socket id it was handed as long as that socket was still connected. That included a
// joiner who had tapped ABORT HANDSHAKE (which told the server nothing) and gone on to
// create or join another squad. They were pulled into both.
//
// Each squad now keeps `pending`, keyed by socket id. Only a pending request can be
// decided, and a request stops being pending when it is decided, withdrawn
// ('cancel-join'), superseded by the same socket or person asking again anywhere, or
// when its socket disconnects. The store has no prototype: socket ids are the keys.

export function addPendingRequest(squad, socketId, { uid = null, name = null, photo = null } = {}) {
  squad.pending = squad.pending || Object.create(null);
  squad.pending[socketId] = { uid, name, photo };
}

// Remove and return `socketId`'s pending request on `squad`, or null if it has none.
export function takePendingRequest(squad, socketId) {
  if (!squad?.pending || typeof socketId !== 'string' || !Object.hasOwn(squad.pending, socketId)) return null;
  const request = squad.pending[socketId];
  delete squad.pending[socketId];
  return request;
}

// Withdraw every request, in any squad, made from `socketId` or by `uid` (the same person
// on an earlier connection). Returns [{ roomCode, targetId }] so the caller can tell each
// squad's Commander.
export function withdrawPendingRequests(activeSquads, { socketId, uid = null }) {
  const withdrawn = [];
  for (const roomCode of Object.keys(activeSquads)) {
    const pending = activeSquads[roomCode].pending;
    if (!pending) continue;
    for (const targetId of Object.keys(pending)) {
      if (targetId === socketId || (uid && pending[targetId].uid === uid)) {
        delete pending[targetId];
        withdrawn.push({ roomCode, targetId });
      }
    }
  }
  return withdrawn;
}

// `squad`'s pending requests, as the 'access-request' payloads its Commander is sent.
export const pendingRequestsOf = (squad, roomCode) =>
  Object.entries(squad?.pending ?? {}).map(([targetId, { name, photo }]) => ({ targetId, name, photo, roomCode }));
