// Presence by uid: members who are still sharing their position with a Group although they
// have no socket to it.
//
// The Group's roster (squad.members) is made of live connections, so a person whose app has
// been swiped away, or whose screen has been off for a while, drops off it and off everyone's
// map. A phone that keeps reporting through the background service (Stage 3) is still there:
// it holds a *lease* on its place in the Group, renewed by every report and valid for as long
// as the phone said it would stay quiet.
//
//   squad.presence[uid] = { uid, name, photo, lat, lng, speed, heading, battery, status,
//                           lastSeen, leaseUntil }
//
// Everything here works on a squad object and takes the time as an argument; nothing touches
// a socket, the clock or the environment. server.js decides what to do about it.
//
// A presence entry is only ever made for a person the Commander admitted (knownUids) and has
// not blocked. It goes when its lease runs out, when they leave, are kicked or blocked, when
// they stop sharing, or when a live connection of theirs takes over (the roster then has them).

const envNumber = (name, fallback) => {
  const value = process.env[`LOCUS_${name}`] === undefined || process.env[`LOCUS_${name}`] === ''
    ? NaN
    : Number(process.env[`LOCUS_${name}`]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// How long a place in the Group is held after the phone's last report: three times what the
// phone said its next report would be within (it slows down when stationary, so this is not
// a fixed number), but never less than the minimum or more than the maximum.
export const LEASE_MIN_SEC = envNumber('LEASE_MIN_SEC', 60);
export const LEASE_MAX_SEC = envNumber('LEASE_MAX_SEC', 900);
export const LEASE_FACTOR = 3;

/** The lease, in seconds, for a phone that said its next report would come within
 *  `nextPostWithinSec`. Missing or nonsense gets the minimum: a phone that does not say how
 *  long it will be quiet is trusted for the least time. */
export function leaseSeconds(nextPostWithinSec, min = LEASE_MIN_SEC, max = LEASE_MAX_SEC) {
  if (typeof nextPostWithinSec !== 'number' || !Number.isFinite(nextPostWithinSec) || nextPostWithinSec <= 0) return min;
  return Math.min(max, Math.max(min, LEASE_FACTOR * nextPostWithinSec));
}

const table = (squad) => (squad.presence ??= Object.create(null));
const finite = (n, fallback) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);
const text = (s) => (typeof s === 'string' ? s : null);
const STATUSES = ['ACTIVE', 'FROZEN'];

/**
 * Records that `uid` reported a position, and renews their lease. Returns the entry, or null
 * when they may not have one: not a person the Commander admitted, blocked, or no usable
 * position.
 *
 * @param {object} squad
 * @param {string} uid
 * @param {{ lat: number, lng: number, speed?: number, heading?: number, battery?: number,
 *   status?: string, name?: string, photo?: string, nextPostWithinSec?: number }} report
 * @param {number} now epoch ms
 * @param {{ min?: number, max?: number }} [lease]
 */
export function setPresence(squad, uid, report, now, lease = {}) {
  if (typeof uid !== 'string' || !uid) return null;
  if (!squad?.knownUids?.includes(uid) || squad.blockedUids?.includes(uid)) return null;
  if (!Number.isFinite(report?.lat) || !Number.isFinite(report?.lng)) return null;

  const profile = squad.profiles?.[uid] ?? {};
  const entry = {
    uid,
    name: text(report.name) ?? profile.name ?? null,
    photo: text(report.photo) ?? profile.photo ?? null,
    lat: report.lat,
    lng: report.lng,
    speed: finite(report.speed, 0),
    heading: finite(report.heading, 0),
    battery: finite(report.battery, 0),
    status: STATUSES.includes(report.status) ? report.status : 'ACTIVE',
    lastSeen: now,
    leaseUntil: now + leaseSeconds(report.nextPostWithinSec, lease.min, lease.max) * 1000,
  };
  table(squad)[uid] = entry;
  return entry;
}

/** `uid`'s presence, if its lease is still running at `now`; otherwise null. Does not remove. */
export function presenceOf(squad, uid, now) {
  const entry = squad?.presence?.[uid];
  return entry && entry.leaseUntil > now ? entry : null;
}

/** Everyone whose lease is still running. */
export function livePresence(squad, now) {
  return Object.values(squad?.presence ?? {}).filter((entry) => entry.leaseUntil > now);
}

export const hasPresence = (squad, now) => livePresence(squad, now).length > 0;

/** Removes `uid`'s presence. Returns whether there was one. */
export function removePresence(squad, uid) {
  if (!squad?.presence || !Object.hasOwn(squad.presence, uid)) return false;
  delete squad.presence[uid];
  return true;
}

/** Removes and returns the entries whose lease has run out at `now`. */
export function expirePresence(squad, now) {
  const expired = [];
  for (const entry of Object.values(squad?.presence ?? {})) {
    if (entry.leaseUntil <= now) {
      expired.push(entry);
      delete squad.presence[entry.uid];
    }
  }
  return expired;
}

/**
 * Everyone in the Group, whether or not they have a connection right now:
 * [{ uid, live, socketId, present, presence }].
 *   live      they have a connected socket on the roster
 *   present   they hold a running lease (they may be live as well)
 * The people are the ones the Commander admitted, plus anyone live or present. Stage 4 uses it
 * to know whom to push to: admitted people who are not live.
 *
 * @param {(socketId: string) => boolean} isLive whether a roster socket is still connected
 */
export function groupMembers(squad, now, isLive) {
  const byUid = new Map();
  const note = (uid) => {
    if (!byUid.has(uid)) byUid.set(uid, { uid, live: false, socketId: null, present: false, presence: null });
    return byUid.get(uid);
  };
  for (const uid of squad?.knownUids ?? []) note(uid);
  for (const socketId of squad?.members ?? []) {
    const uid = squad.memberUids?.[socketId];
    if (!uid || !isLive(socketId)) continue;
    Object.assign(note(uid), { live: true, socketId });
  }
  for (const entry of livePresence(squad, now)) Object.assign(note(entry.uid), { present: true, presence: entry });
  return [...byUid.values()];
}

/** The uids with a connected socket on the roster. */
export function liveUids(squad, isLive) {
  const uids = new Set();
  for (const socketId of squad?.members ?? []) {
    const uid = squad.memberUids?.[socketId];
    if (uid && isLive(socketId)) uids.add(uid);
  }
  return uids;
}

// The key a presence member goes by in the roster everyone is sent. Roster keys are socket
// ids, which a presence member does not have, and a uid is not one; the prefix keeps the two
// from ever being mistaken for each other.
export const PRESENCE_KEY_PREFIX = 'bg:';
export const presenceKey = (uid) => `${PRESENCE_KEY_PREFIX}${uid}`;

/** The uid behind a roster key made by presenceKey(), or null for anything else. */
export const uidOfPresenceKey = (key) =>
  typeof key === 'string' && key.startsWith(PRESENCE_KEY_PREFIX) && key.length > PRESENCE_KEY_PREFIX.length
    ? key.slice(PRESENCE_KEY_PREFIX.length)
    : null;
