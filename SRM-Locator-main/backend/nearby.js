// Nearby Join (Stage 3): find people standing close by who are in no Group, and invite them.
//
// Off unless LOCUS_NEARBY_ENABLED is "true". Then:
//   - A person in no Group may make themselves *discoverable*. Only then does the server keep their
//     lobby connection open past the pre-join close and take a position from the lobby. That
//     position is kept in memory only, on their discoverable record, never logged and never sent to
//     anyone; it goes when they stop being discoverable (they opt out, disconnect, or join a Group).
//   - The admin or a moderator of a Group scans. The scan answers names only, never positions, and
//     only people who pass the distance rule (isNearby). Each name comes with an opaque id good for
//     that scan only, never anyone's account id.
//   - Inviting records an invite against the person's account, one open invite per person per Group,
//     for NEARBY_INVITE_TTL_MS. Nobody joins without accepting their own invite.
//
// GPS indoors can be off by 10-20 m, so the rule fails quietly rather than guess: a stale position,
// an accuracy that is unknown (older apps send none) or worse than the radius, or a distance over it,
// and the person is simply not listed.

export const NEARBY_RADIUS_M = 15; // the "nearby" distance, and the worst accuracy accepted
export const NEARBY_MAX_FIX_AGE_MS = 20_000; // a position older than this is not used
export const NEARBY_INVITE_TTL_MS = 2 * 60 * 1000; // an invite unanswered this long is gone
export const NEARBY_SCANS_PER_MIN = 6; // scans one person may make a minute

/** Whether Nearby Join is on. Off unless LOCUS_NEARBY_ENABLED is "true". */
export const nearbyEnabled = (env = process.env) => env.LOCUS_NEARBY_ENABLED === 'true';

/** Tests only: shorter invite and fix-age windows. Ignored in production. */
export function nearbyTimings(env = process.env) {
  const override = (name, fallback) => {
    const value = Number(env[name]);
    return env.NODE_ENV !== 'production' && Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    inviteTtlMs: override('LOCUS_NEARBY_INVITE_TTL_MS', NEARBY_INVITE_TTL_MS),
    maxFixAgeMs: override('LOCUS_NEARBY_MAX_FIX_AGE_MS', NEARBY_MAX_FIX_AGE_MS),
  };
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const realFix = (fix) => Number.isFinite(fix?.lat) && Number.isFinite(fix?.lng)
  && Math.abs(fix.lat) <= 90 && Math.abs(fix.lng) <= 180;

/** A position worth keeping from a phone: { lat, lng, accuracy|null, at }, or null. */
export function cleanFix(report, now) {
  if (!realFix(report)) return null;
  const accuracy = Number.isFinite(report.accuracy) && report.accuracy > 0 ? report.accuracy : null;
  return { lat: report.lat, lng: report.lng, accuracy, at: now };
}

/**
 * The distance rule. `a` and `b` are { lat, lng, accuracy, at }. Both must be fresher than
 * `maxAgeMs`, each accuracy known and within `radiusM`, and the distance within `radiusM`.
 */
export function isNearby(a, b, now, { radiusM = NEARBY_RADIUS_M, maxAgeMs = NEARBY_MAX_FIX_AGE_MS } = {}) {
  for (const fix of [a, b]) {
    if (!realFix(fix) || !Number.isFinite(fix.at)) return false;
    if (now - fix.at > maxAgeMs || fix.at > now + 1000) return false;
    if (!Number.isFinite(fix.accuracy) || fix.accuracy <= 0 || fix.accuracy > radiusM) return false;
  }
  return distanceM(a, b) <= radiusM;
}

/**
 * Open invites, by Group and account: at most one open per person per Group. An invite is used
 * once (accepted or declined). A used or expired invite is kept a while longer as a record (another
 * ttlMs, and at least INVITE_RECORD_MIN_MS), so a late answer is told "used" or "expired" rather than
 * "no invite"; it no longer counts as open, so the person can be invited again.
 */
export const INVITE_RECORD_MIN_MS = 60 * 1000;
export function createInviteBook({ ttlMs = NEARBY_INVITE_TTL_MS } = {}) {
  const recordMs = Math.max(ttlMs, INVITE_RECORD_MIN_MS);
  const open = new Map(); // `${roomCode}\n${uid}` -> invite still open
  const byId = new Map(); // inviteId -> invite (open, or kept as a record)
  let seq = 0;
  const keyOf = (roomCode, uid) => `${roomCode}\n${uid}`;
  const close = (invite) => {
    if (open.get(keyOf(invite.roomCode, invite.uid)) === invite) open.delete(keyOf(invite.roomCode, invite.uid));
  };

  return {
    ttlMs,
    /** Invites `uid` to `roomCode`, unless they already hold an open one (which is kept as it is). */
    offer({ roomCode, uid, byUid = null, byName = null }, now, makeId) {
      const current = open.get(keyOf(roomCode, uid));
      if (current && current.expiresAt > now) return { invite: current, created: false };
      if (current) close(current);
      seq += 1;
      const invite = { id: makeId ? makeId() : `inv${seq}`, roomCode, uid, byUid, byName, createdAt: now, expiresAt: now + ttlMs, used: false, lapsed: false };
      open.set(keyOf(roomCode, uid), invite);
      byId.set(invite.id, invite);
      return { invite, created: true };
    },
    /**
     * Uses invite `id` for `uid`. Returns { ok: true, invite } or { ok: false, reason }:
     * 'no-invite' (unknown, or not theirs), 'used', 'expired'.
     */
    use(id, uid, now) {
      const invite = byId.get(id);
      if (!invite || invite.uid !== uid) return { ok: false, reason: 'no-invite' };
      if (invite.used) return { ok: false, reason: 'used' };
      if (invite.lapsed || invite.expiresAt <= now) {
        invite.lapsed = true;
        close(invite);
        return { ok: false, reason: 'expired' };
      }
      invite.used = true;
      close(invite);
      return { ok: true, invite };
    },
    /** Closes invites past their expiry, returning each one never answered (once), and forgets old records. */
    sweep(now) {
      const lapsed = [];
      for (const invite of [...byId.values()]) {
        if (invite.expiresAt > now) continue;
        if (!invite.used && !invite.notified) {
          invite.lapsed = true;
          invite.notified = true;
          lapsed.push(invite);
        }
        close(invite);
        if (invite.expiresAt + recordMs <= now) byId.delete(invite.id);
      }
      return lapsed;
    },
    size: () => byId.size,
  };
}
