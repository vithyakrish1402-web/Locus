// Who may do what in a Group: one main admin, any number of moderators, and members.
//
// The main admin is whoever holds command right now (squad.ownerId): the Commander, or a
// stand-in while the Commander is away (see squadRoster.js and request-join in server.js).
// Nothing about command, succession or reclaim changes here; roles only sit on top of it.
// Moderators are kept by stable identity (Firebase uid) in squad.moderatorUids, so a
// moderator is still one after a reconnect. A Group made before roles existed has no
// moderatorUids, so its leader is the admin and everyone else a member, exactly as before.
//
// Everything the server allows by role is read from PERMISSIONS below, in one place.

export const ROLE_ADMIN = 'admin';
export const ROLE_MODERATOR = 'moderator';
export const ROLE_MEMBER = 'member';

// The permissions table. Each action lists the roles allowed to do it.
export const PERMISSIONS = Object.freeze({
  admitOne: [ROLE_ADMIN, ROLE_MODERATOR], // approve or reject one join request
  admitAll: [ROLE_ADMIN], // approve every waiting request at once
  kick: [ROLE_ADMIN, ROLE_MODERATOR], // remove a member (they must ask again to come back)
  block: [ROLE_ADMIN, ROLE_MODERATOR], // remove a member and keep them out
  unblock: [ROLE_ADMIN, ROLE_MODERATOR], // let a blocked person ask to join again
  setModerator: [ROLE_ADMIN], // promote or demote a moderator (also needs to be the Commander, see canSetModerators)
  readActivityLog: [ROLE_ADMIN, ROLE_MODERATOR], // the Group's activity log and its export
  seeJoinQueue: [ROLE_ADMIN, ROLE_MODERATOR], // receives join requests and the waiting count
});

/** The role of the person on `socketId` (uid `uid`) in `squad`. Anyone not on the roster is a member. */
export function roleOf(squad, socketId, uid) {
  if (!squad || !squad.members?.includes(socketId)) return ROLE_MEMBER;
  if (squad.ownerId === socketId) return ROLE_ADMIN;
  if (uid && squad.moderatorUids?.includes(uid)) return ROLE_MODERATOR;
  return ROLE_MEMBER;
}

export const can = (role, action) => Boolean(PERMISSIONS[action]?.includes(role));

/**
 * Whether someone of `actorRole`, already allowed to kick or block (PERMISSIONS), may do it to
 * the person `target` describes: { isAdmin, isCommander, isModerator }. Nobody touches the
 * admin or the Group's own Commander (a stand-in blocking the Commander would make "for now"
 * permanent), and a moderator never touches another moderator.
 */
export function canActOn(actorRole, target) {
  if (!target || target.isAdmin || target.isCommander) return false;
  return !(actorRole === ROLE_MODERATOR && target.isModerator);
}

/** Only the Group's own Commander, holding command, promotes and demotes moderators (a stand-in
 *  holds command for a while, but the Group is not theirs to reorganise). A Group with no uids at
 *  all (an old client) falls back to whoever holds command. */
export function canSetModerators(squad, socketId, socketUid, commanderUid) {
  if (!squad || squad.ownerId !== socketId) return false;
  return !commanderUid || socketUid === commanderUid;
}

/** Makes `uid` a moderator or not. Returns whether anything changed. */
export function setModerator(squad, uid, on) {
  if (!squad || typeof uid !== 'string' || !uid) return false;
  const list = squad.moderatorUids ?? [];
  const has = list.includes(uid);
  if (on && !has) squad.moderatorUids = [...list, uid];
  else if (!on && has) squad.moderatorUids = list.filter((m) => m !== uid);
  else return false;
  return true;
}

/** A person leaving, kicked or blocked stops being a moderator. */
export const dropModerator = (squad, uid) => setModerator(squad, uid, false);

// --- Blocked people ---------------------------------------------------------------------
// squad.blockedUids is what request-join checks. Names are kept beside it only so a moderator
// or the admin can see who they are unblocking. In memory, like the squad: a Render restart
// forgets both, and a blocked person can then ask to join again.

export function rememberBlocked(squad, uid, name) {
  if (!squad || !uid) return;
  squad.blockedUids = squad.blockedUids || [];
  if (!squad.blockedUids.includes(uid)) squad.blockedUids.push(uid);
  squad.blockedNames ??= Object.create(null);
  squad.blockedNames[uid] = typeof name === 'string' ? name.slice(0, 60) : null;
}

/** Returns whether `uid` was blocked. */
export function forgetBlocked(squad, uid) {
  if (!squad?.blockedUids?.includes(uid)) return false;
  squad.blockedUids = squad.blockedUids.filter((b) => b !== uid);
  if (squad.blockedNames) delete squad.blockedNames[uid];
  return true;
}

export const blockedList = (squad) =>
  (squad?.blockedUids ?? []).map((uid) => ({ uid, name: squad.blockedNames?.[uid] ?? null }));
