import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { createDeviceTokens, MAX_TOKEN_LENGTH } from '../backend/deviceToken.js';
import { createRateLimiter } from '../backend/rateLimit.js';

/** The device token's signature, expiry and shape (backend/deviceToken.js), and the rate limiter. */

const SECRET = 'a-long-random-secret-for-the-tests-0123456789';
const NOW = Date.UTC(2026, 9, 15, 6, 0, 0);
const SID = 'AAAAAAAAAAAAAAAAAAAAAAAA'; // 24 base64url characters
const claims = { uid: 'uB', room: 'ROOM1', sid: SID, ttlSec: 14 * 86400 };

const tokensAt = (ms, secret = SECRET) => createDeviceTokens(secret, () => ms);
const body = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
// A correctly signed token with any payload, to test what the signature does not cover.
const signed = (payload, secret = SECRET) => {
  const b = encode(payload);
  return `v1.${b}.${createHmac('sha256', secret).update(`v1.${b}`).digest('base64url')}`;
};

describe('a device token', () => {
  it('verifies, and says who it is for, which Group, which session and until when', () => {
    const { token, expiresAt } = tokensAt(NOW).sign(claims);
    expect(token.startsWith('v1.')).toBe(true);
    expect(token.length).toBeLessThan(MAX_TOKEN_LENGTH);
    expect(expiresAt).toBe(NOW + 14 * 86400 * 1000);
    expect(tokensAt(NOW).verify(token)).toEqual({
      ok: true,
      payload: { uid: 'uB', room: 'ROOM1', sid: SID, iat: NOW / 1000, exp: NOW / 1000 + 14 * 86400 },
    });
  });

  it('does not contain the secret', () => {
    expect(tokensAt(NOW).sign(claims).token).not.toContain(SECRET);
  });

  it('expires at its expiry second, not before', () => {
    const { token, expiresAt } = tokensAt(NOW).sign(claims);
    expect(tokensAt(expiresAt - 1000).verify(token).ok).toBe(true);
    expect(tokensAt(expiresAt).verify(token)).toEqual({ ok: false, reason: 'expired' });
    expect(tokensAt(expiresAt + 86400000).verify(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('is refused if it claims to be from the future, beyond a minute of clock difference', () => {
    const { token } = tokensAt(NOW + 5 * 60000).sign(claims);
    expect(tokensAt(NOW).verify(token)).toEqual({ ok: false, reason: 'malformed' });
    expect(tokensAt(NOW + 4 * 60000).verify(token).ok).toBe(true);
  });

  it('is refused if anything in it was changed', () => {
    const { token } = tokensAt(NOW).sign(claims);
    const [v, b, s] = token.split('.');
    const other = (patch) => `${v}.${encode({ ...body(token), ...patch })}.${s}`;
    for (const forged of [
      other({ uid: 'uA' }), other({ room: 'OTHER' }), other({ sid: 'B'.repeat(24) }), other({ exp: body(token).exp + 1e6 }),
      `v1.${b}.${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`, // one character of the signature
      `v1.${b}.${s}x`, `v1.${b}.${s.slice(1)}`, `v1.${b}.`,
    ]) {
      expect(tokensAt(NOW).verify(forged).ok).toBe(false);
    }
    expect(tokensAt(NOW).verify(other({ uid: 'uA' })).reason).toBe('bad-signature');
  });

  it('is refused under another secret', () => {
    const { token } = tokensAt(NOW, 'a-completely-different-secret-0123456789').sign(claims);
    expect(tokensAt(NOW).verify(token)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('is refused when it is not shaped like a token, whatever it is', () => {
    const { token } = tokensAt(NOW).sign(claims);
    for (const bad of [
      undefined, null, 5, {}, [], true, '', ' ', 'v1', 'v1..', 'v1.a', 'v1.a.b.c', 'v2.' + token.slice(3), token.replace('v1.', 'V1.'),
      `${token} `, ` ${token}`, `${token}\n`, token.replace('.', '. '), 'a'.repeat(MAX_TOKEN_LENGTH + 1), token + 'a'.repeat(MAX_TOKEN_LENGTH),
      'v1.!!!.???', 'v1.' + 'é'.repeat(5) + '.sig',
    ]) {
      expect(tokensAt(NOW).verify(bad).ok).toBe(false);
    }
  });

  it('is refused when it is too long even if the signature is genuine', () => {
    const good = { uid: 'uB', room: 'R', sid: SID, iat: NOW / 1000, exp: NOW / 1000 + 100 };
    const padded = signed({ ...good, pad: 'x'.repeat(MAX_TOKEN_LENGTH) });
    expect(padded.length).toBeGreaterThan(MAX_TOKEN_LENGTH);
    expect(tokensAt(NOW).verify(padded)).toEqual({ ok: false, reason: 'malformed' });
    expect(tokensAt(NOW).verify(signed(good)).ok).toBe(true);
  });

  it('is refused when it is correctly signed but says something impossible', () => {
    const good = { uid: 'uB', room: 'R', sid: SID, iat: NOW / 1000, exp: NOW / 1000 + 100 };
    expect(tokensAt(NOW).verify(signed(good)).ok).toBe(true);
    for (const patch of [
      { uid: '' }, { uid: 5 }, { uid: 'u'.repeat(129) }, { room: '' }, { room: 7 }, { room: 'r'.repeat(65) },
      { sid: 'short' }, { sid: 5 }, { sid: 'a b'.repeat(8) }, { iat: 'x' }, { iat: 1.5 }, { exp: null }, { exp: '99999999999' },
    ]) {
      expect(tokensAt(NOW).verify(signed({ ...good, ...patch })).ok).toBe(false);
    }
    for (const payload of [null, 5, 'x', [], {}]) expect(tokensAt(NOW).verify(signed(payload)).ok).toBe(false);
    // Valid base64url that is not JSON, signed.
    const raw = Buffer.from('not json').toString('base64url');
    const notJson = `v1.${raw}.${createHmac('sha256', SECRET).update(`v1.${raw}`).digest('base64url')}`;
    expect(tokensAt(NOW).verify(notJson)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('cannot be made without a secret', () => {
    for (const bad of [undefined, null, '', 5]) expect(() => createDeviceTokens(bad)).toThrow();
  });
});

describe('the rate limiter', () => {
  it('lets `limit` through per window and then says how long to wait', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60000, now: () => t });
    expect([1, 2, 3].map(() => limiter.check('k').ok)).toEqual([true, true, true]);
    t = 20000;
    expect(limiter.check('k')).toEqual({ ok: false, retryAfterSec: 40 });
    t = 59999;
    expect(limiter.check('k')).toEqual({ ok: false, retryAfterSec: 1 });
    t = 60000;
    expect(limiter.check('k').ok).toBe(true); // a new window
  });

  it('counts every key on its own', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('b').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(false);
    expect(limiter.check('b').ok).toBe(false);
  });

  it('is safe for any key, including odd strings', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    for (const key of ['__proto__', 'constructor', '', undefined, null, 5]) expect(limiter.check(key).ok).toBe(true);
    expect(limiter.check('__proto__').ok).toBe(false);
  });

  it('stays within its bound however many keys arrive', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 5, windowMs: 1000, maxKeys: 100, now: () => t });
    for (let i = 0; i < 5000; i++) limiter.check(`ip-${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(100);
    t = 5000;
    for (let i = 0; i < 10; i++) limiter.check(`later-${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(100);
  });
});
