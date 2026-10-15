// The device token: a signed note that lets one phone report one person's position to one
// Group while LOCUS is closed, and nothing else.
//
//   v1.<payload>.<signature>     payload = base64url(JSON { uid, room, sid, iat, exp })
//                                signature = base64url(HMAC-SHA256(secret, "v1." + payload))
//
// uid   the person (verified from their Firebase ID token when the token was issued)
// room  the one Group it is for
// sid   the sharing session it belongs to. The Group keeps the current session id per person
//       (squad.sessions), so a token is only good while its session is: issuing a new one,
//       stopping, leaving, being removed, or the Group being re-created all end it, whatever
//       the expiry says (see backgroundSharing.js)
// iat/exp  seconds since the epoch
//
// This file only signs and checks signatures and expiry. It never logs, and nothing it
// returns includes the secret.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_VERSION = 'v1';
export const MAX_TOKEN_LENGTH = 600;
const MAX_UID_LENGTH = 128;
const MAX_ROOM_LENGTH = 64;
const SID_SHAPE = /^[A-Za-z0-9_-]{16,32}$/;
const PART_SHAPE = /^[A-Za-z0-9_-]+$/;
// How far ahead of the server's clock a token's issue time may be.
const CLOCK_SKEW_SEC = 60;

const mac = (secret, body) => createHmac('sha256', secret).update(`${TOKEN_VERSION}.${body}`).digest('base64url');

/** @param {string} secret @param {() => number} [now] epoch ms */
export function createDeviceTokens(secret, now = Date.now) {
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('A device-token secret is required');

  return {
    /** payload: { uid, room, sid, ttlSec } -> { token, expiresAt (epoch ms) } */
    sign({ uid, room, sid, ttlSec }) {
      const iat = Math.floor(now() / 1000);
      const exp = iat + ttlSec;
      const body = Buffer.from(JSON.stringify({ uid, room, sid, iat, exp })).toString('base64url');
      return { token: `${TOKEN_VERSION}.${body}.${mac(secret, body)}`, expiresAt: exp * 1000 };
    },

    /** -> { ok: true, payload } | { ok: false, reason: 'malformed' | 'bad-signature' | 'expired' } */
    verify(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'malformed' };
      const parts = token.split('.');
      if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !PART_SHAPE.test(parts[1]) || !PART_SHAPE.test(parts[2])) {
        return { ok: false, reason: 'malformed' };
      }
      const [, body, signature] = parts;

      // Compared in constant time. Different lengths cannot be equal, and timingSafeEqual
      // throws on them, so they are refused first.
      const expected = Buffer.from(mac(secret, body));
      const given = Buffer.from(signature);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad-signature' };

      let payload;
      try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return { ok: false, reason: 'malformed' };
      }
      const { uid, room, sid, iat, exp } = payload ?? {};
      if (
        typeof uid !== 'string' || uid.length === 0 || uid.length > MAX_UID_LENGTH ||
        typeof room !== 'string' || room.length === 0 || room.length > MAX_ROOM_LENGTH ||
        typeof sid !== 'string' || !SID_SHAPE.test(sid) ||
        !Number.isInteger(iat) || !Number.isInteger(exp)
      ) {
        return { ok: false, reason: 'malformed' };
      }
      const seconds = now() / 1000;
      if (iat > seconds + CLOCK_SKEW_SEC) return { ok: false, reason: 'malformed' };
      if (exp <= seconds) return { ok: false, reason: 'expired' };
      return { ok: true, payload: { uid, room, sid, iat, exp } };
    },
  };
}
