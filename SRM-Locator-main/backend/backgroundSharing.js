// Sharing a position while LOCUS is closed: the three HTTPS endpoints the Android background
// service talks to (Stage 3b), mounted at /api/background.
//
//   POST   /token     Authorization: Bearer <Firebase ID token>, { roomCode }
//                     -> { token, expiresAt, ttlSeconds }   a device token for that one Group
//   POST   /location  Authorization: Bearer <device token>, { lat, lng, nextPostWithinSec, ... }
//                     -> { ok, leaseSec, serverTime }       renews the person's lease (presence.js)
//   DELETE /session   Authorization: Bearer <device token>
//                     -> { ok }                             the person stops sharing
//   GET    /status    no authorisation
//                     -> { available }                      whether the above are switched on (answers 200 even when off)
//
// OFF unless LOCUS_BACKGROUND_SHARING_ENABLED=true AND LOCUS_DEVICE_TOKEN_SECRET is a proper
// secret; off, all three answer 503 and nothing else in the server changes.
//
// Who may do what is decided here and only here:
//  - issuing needs a verified identity (identity.js) and that the person was admitted to the Group;
//  - a device token (deviceToken.js) works only for its person, its Group, and its *session*: the
//    Group keeps one current session id per person (squad.sessions[uid]). Issuing again replaces
//    it, and stopping, leaving, being removed or blocked, or the Group being re-created (after a
//    restart, say) ends it, whatever the token's expiry says;
//  - every report is re-checked against the Group's roster by the same function that puts the
//    person on the map (acceptBackgroundPosition in server.js).
//
// Nothing here logs a token or a coordinate, and nothing is stored beyond what the live
// pipeline already holds. A malformed request is answered with a 4xx and never throws.

import express from 'express';
import { randomBytes } from 'node:crypto';
import { createDeviceTokens } from './deviceToken.js';
import { createRateLimiter } from './rateLimit.js';

const number = (raw, fallback) => {
  const value = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const MIN_SECRET_LENGTH = 32;

export const backgroundConfig = (env = process.env) => ({
  enabled: env.LOCUS_BACKGROUND_SHARING_ENABLED === 'true',
  secret: env.LOCUS_DEVICE_TOKEN_SECRET || '',
  // A forgotten or stolen token stops sharing someone's position after this long; the app renews
  // it every time it opens.
  deviceTokenTtlDays: number(env.LOCUS_DEVICE_TOKEN_TTL_DAYS, 14),
  // Fixed one-minute windows. A phone on the Fast setting reports once a second.
  postsPerMinutePerToken: number(env.LOCUS_BG_POSTS_PER_MIN_TOKEN, 90),
  // Many students share one address (campus NAT, a hotspot), so this is generous.
  postsPerMinutePerIp: number(env.LOCUS_BG_POSTS_PER_MIN_IP, 1500),
  mintsPerMinutePerIp: number(env.LOCUS_BG_MINTS_PER_MIN_IP, 60),
  mintsPerMinutePerUid: number(env.LOCUS_BG_MINTS_PER_MIN_UID, 10),
});

/** { active, reason }: reason is 'off', 'no-secret' or 'weak-secret' when not active. */
export function backgroundStatus(config) {
  if (!config.enabled) return { active: false, reason: 'off' };
  if (!config.secret) return { active: false, reason: 'no-secret' };
  if (config.secret.length < MIN_SECRET_LENGTH) return { active: false, reason: 'weak-secret' };
  return { active: true, reason: null };
}

/** The line logged at startup. Never contains the secret. */
export function backgroundStartupLine(config) {
  const { active, reason } = backgroundStatus(config);
  if (active) return `[BACKGROUND] Background sharing is ON (device tokens last ${config.deviceTokenTtlDays} days).`;
  const why = {
    off: 'LOCUS_BACKGROUND_SHARING_ENABLED is not "true"',
    'no-secret': 'LOCUS_DEVICE_TOKEN_SECRET is not set',
    'weak-secret': `LOCUS_DEVICE_TOKEN_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`,
  }[reason];
  return `[BACKGROUND] Background sharing is OFF: ${why}. The endpoints answer 503.`;
}

// --- Sessions: which device token is current, per person, on a squad -----------------------------

const sessionsOf = (squad) => (squad.sessions ??= Object.create(null));

/** Starts a fresh session for `uid`, ending any earlier one. Returns its id. */
export function startSession(squad, uid) {
  const sid = randomBytes(18).toString('base64url');
  sessionsOf(squad)[uid] = sid;
  return sid;
}

export const sessionIsCurrent = (squad, uid, sid) => typeof sid === 'string' && squad?.sessions?.[uid] === sid;

export function endSession(squad, uid) {
  if (squad?.sessions && Object.hasOwn(squad.sessions, uid)) delete squad.sessions[uid];
}

/** Ends every session `uid` has, in every squad. Returns how many were ended. */
export function endAllSessions(squads, uid) {
  let ended = 0;
  for (const roomCode of Object.keys(squads)) {
    if (squads[roomCode].sessions && Object.hasOwn(squads[roomCode].sessions, uid)) {
      delete squads[roomCode].sessions[uid];
      ended += 1;
    }
  }
  return ended;
}

// --- What a report may say -------------------------------------------------------------------------

const RANGES = {
  lat: [-90, 90],
  lng: [-180, 180],
  nextPostWithinSec: [1, 300], // so 3x stays within the longest lease
  speed: [0, 400], // km/h, as the app reports it
  heading: [0, 360],
  battery: [0, 100],
  accuracy: [0, 100000], // metres
};
const REQUIRED = ['lat', 'lng', 'nextPostWithinSec'];
const STATUSES = ['ACTIVE', 'FROZEN'];
// When the fix was taken, if the phone says: it may be a little old (a queue after a dead
// zone) or a little ahead (clocks), not wildly either.
const TIMESTAMP_PAST_MS = 10 * 60 * 1000;
const TIMESTAMP_FUTURE_MS = 2 * 60 * 1000;

/** -> { ok: true, report } | { ok: false, field }. Reads only the fields it knows, by name. */
export function parseReport(body, now) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: 'body' };
  const report = {};
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const value = Object.hasOwn(body, key) ? body[key] : undefined;
    if (value === undefined || value === null) {
      if (REQUIRED.includes(key)) return { ok: false, field: key };
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return { ok: false, field: key };
    report[key] = value;
  }
  if (Object.hasOwn(body, 'status') && body.status !== undefined && body.status !== null) {
    if (!STATUSES.includes(body.status)) return { ok: false, field: 'status' };
    report.status = body.status;
  }
  if (Object.hasOwn(body, 'timestamp') && body.timestamp !== undefined && body.timestamp !== null) {
    const t = body.timestamp;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < now - TIMESTAMP_PAST_MS || t > now + TIMESTAMP_FUTURE_MS) {
      return { ok: false, field: 'timestamp' };
    }
  }
  return { ok: true, report };
}

// --- The router ----------------------------------------------------------------------------------------

const BEARER = /^Bearer ([A-Za-z0-9._-]{1,4096})$/;
const MAX_ROOM_CODE_LENGTH = 64;

/**
 * @param {object} deps
 * @param {ReturnType<typeof backgroundConfig>} deps.config
 * @param {(token: string) => Promise<{ ok: boolean, uid?: string, reason?: string }>} deps.verifyIdToken
 * @param {(roomCode: string) => object|undefined} deps.getSquad
 * @param {(roomCode: string, uid: string, report: object, now: number) => { ok: boolean, reason?: string, leaseUntil?: number }} deps.accept
 * @param {(roomCode: string, uid: string) => void} deps.endSharing takes them off the map, quietly
 * @param {() => number} [deps.now]
 */
export function createBackgroundRouter({ config, verifyIdToken, getSquad, accept, endSharing, now = Date.now }) {
  const router = express.Router();
  const status = backgroundStatus(config);
  const tokens = status.active ? createDeviceTokens(config.secret, now) : null;

  const limiters = {
    postToken: createRateLimiter({ limit: config.postsPerMinutePerToken, windowMs: 60000, now }),
    postIp: createRateLimiter({ limit: config.postsPerMinutePerIp, windowMs: 60000, now }),
    mintIp: createRateLimiter({ limit: config.mintsPerMinutePerIp, windowMs: 60000, now }),
    mintUid: createRateLimiter({ limit: config.mintsPerMinutePerUid, windowMs: 60000, now }),
  };

  const fail = (res, code, error, extra = {}) => res.status(code).json({ error, ...extra });
  const limited = (res, result) => {
    res.set('Retry-After', String(result.retryAfterSec));
    return fail(res, 429, 'rate-limited', { retryAfterSec: result.retryAfterSec });
  };
  const bearer = (req) => BEARER.exec(req.get('authorization') ?? '')?.[1] ?? null;

  // Whether background sharing is available at all, so the app can leave its switch out when it is
  // not. Registered BEFORE the check below, which answers 503 to everything else when it is off.
  // Open to anyone and says only that: no configuration, no secrets, no counts.
  router.get('/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ available: status.active });
  });

  // Off, or not properly configured: nothing else here exists.
  router.use((req, res, next) => (status.active ? next() : fail(res, 503, 'disabled')));
  // Small bodies only; anything else is refused before it is parsed.
  router.use(express.json({ limit: '2kb' }));

  // A device token that is good right now, for a Group that still exists, in a session that is
  // still current. -> { payload, squad } or sends the refusal and returns null.
  const authorise = (req, res, { requireSession = true } = {}) => {
    const given = bearer(req);
    if (!given) { fail(res, 401, 'missing-token'); return null; }
    const checked = tokens.verify(given);
    if (!checked.ok) { fail(res, 401, 'invalid-token', { reason: checked.reason }); return null; }
    const { payload } = checked;
    const squad = getSquad(payload.room);
    if (!squad) { fail(res, 410, 'no-group'); return null; }
    if (requireSession && !sessionIsCurrent(squad, payload.uid, payload.sid)) { fail(res, 401, 'invalid-token', { reason: 'revoked' }); return null; }
    return { payload, squad };
  };

  router.post('/token', async (req, res) => {
    const ipCheck = limiters.mintIp.check(req.ip);
    if (!ipCheck.ok) return limited(res, ipCheck);

    const idToken = bearer(req);
    if (!idToken) return fail(res, 401, 'missing-token');
    const roomCode = req.body?.roomCode;
    if (typeof roomCode !== 'string' || roomCode.length === 0 || roomCode.length > MAX_ROOM_CODE_LENGTH) return fail(res, 400, 'bad-request', { field: 'roomCode' });

    const identity = await verifyIdToken(idToken);
    if (!identity.ok) {
      return identity.reason === 'unavailable'
        ? fail(res, 503, 'identity-unavailable')
        : fail(res, 401, 'invalid-token', { reason: identity.reason });
    }
    const uidCheck = limiters.mintUid.check(identity.uid);
    if (!uidCheck.ok) return limited(res, uidCheck);

    const squad = getSquad(roomCode);
    if (!squad) return fail(res, 404, 'no-group');
    if (squad.blockedUids?.includes(identity.uid)) return fail(res, 403, 'blocked');
    if (!squad.knownUids?.includes(identity.uid)) return fail(res, 403, 'not-member');

    const sid = startSession(squad, identity.uid);
    const ttlSeconds = Math.round(config.deviceTokenTtlDays * 24 * 60 * 60);
    const { token, expiresAt } = tokens.sign({ uid: identity.uid, room: roomCode, sid, ttlSec: ttlSeconds });
    return res.status(200).json({ token, expiresAt, ttlSeconds });
  });

  router.post('/location', (req, res) => {
    const given = bearer(req);
    if (!given) return fail(res, 401, 'missing-token');
    // The address is counted before anything else is learned about the caller.
    const ipCheck = limiters.postIp.check(req.ip);
    if (!ipCheck.ok) return limited(res, ipCheck);

    const auth = authorise(req, res);
    if (!auth) return undefined;
    const { payload } = auth;
    const tokenCheck = limiters.postToken.check(payload.sid);
    if (!tokenCheck.ok) return limited(res, tokenCheck);

    const at = now();
    const parsed = parseReport(req.body, at);
    if (!parsed.ok) return fail(res, 400, 'bad-request', { field: parsed.field });

    const result = accept(payload.room, payload.uid, parsed.report, at);
    if (!result.ok) {
      const code = { 'no-group': 410, blocked: 403, 'not-member': 403, 'bad-report': 400 }[result.reason] ?? 400;
      return fail(res, code, result.reason);
    }
    return res.status(200).json({ ok: true, leaseSec: Math.round((result.leaseUntil - at) / 1000), serverTime: at });
  });

  router.delete('/session', (req, res) => {
    // A valid signature is enough to stop: stopping twice, or after the session was already
    // ended some other way, is not an error.
    const auth = authorise(req, res, { requireSession: false });
    if (!auth) return undefined;
    const { payload, squad } = auth;
    const wasCurrent = sessionIsCurrent(squad, payload.uid, payload.sid);
    if (wasCurrent) {
      endSession(squad, payload.uid);
      endSharing(payload.room, payload.uid);
    }
    return res.status(200).json({ ok: true });
  });

  // Whatever went wrong before a handler (a body that is not JSON, one that is too large, a
  // body parser failure) or inside one: a JSON answer, never a stack trace, never a crash.
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return fail(res, 413, 'too-large');
    if (err?.type === 'entity.parse.failed' || err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') return fail(res, 400, 'bad-request', { field: 'body' });
    return fail(res, err?.status >= 400 && err?.status < 500 ? err.status : 500, err?.status >= 400 && err?.status < 500 ? 'bad-request' : 'server-error');
  });

  return router;
}
