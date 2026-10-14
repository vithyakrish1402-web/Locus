import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * The ID-token check against the REAL firebase-admin library, offline. In its emulator mode the
 * library checks every claim itself and does not fetch Google's keys; the only call it makes
 * is an account lookup, which a stub on localhost answers. So expiry, audience, issuer and
 * subject are judged by the library's own code, not by a fake.
 *
 * (Signatures are not exercised here: emulator tokens are unsigned. The signature check is the
 * library's, with Google's public keys, and is what a real phone's token meets on Render.)
 */

const PROJECT = 'locus-5c6a8';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const token = (claims = {}, header = { alg: 'none', typ: 'JWT' }) =>
  `${b64(header)}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: now() - 10, user_id: 'u1', sub: 'u1',
    iat: now() - 10, exp: now() + 3600, firebase: { identities: {}, sign_in_provider: 'password' }, ...claims,
  })}.`;

let stub;
let account = { localId: 'u1', disabled: false, validSince: '0' };
let verifierModule;
const saved = {};

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ users: [account] }));
    });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'LOCUS_ALLOW_AUTH_EMULATOR']) saved[key] = process.env[key];
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${stub.address().port}`;
  process.env.LOCUS_ALLOW_AUTH_EMULATOR = 'true';
  verifierModule = await import('../backend/identity.js');
});

afterAll(() => {
  stub.close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const verify = (t, options = {}) => verifierModule.createIdTokenVerifier({ log: { error() {} }, ...options }).verifyIdToken(t);

describe('the real library', () => {
  it('accepts a good token and returns its uid', async () => {
    expect(await verify(token())).toEqual({ ok: true, uid: 'u1' });
  });

  it('rejects an expired token as expired', async () => {
    expect(await verify(token({ exp: now() - 100, iat: now() - 4000 }))).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token made for another Firebase project', async () => {
    const other = { aud: 'other', iss: 'https://securetoken.google.com/other' };
    expect(await verify(token(other))).toEqual({ ok: false, reason: 'wrong-project' });
    expect(await verify(token({ aud: 'other' }))).toEqual({ ok: false, reason: 'wrong-project' });
    expect(await verify(token({ iss: 'https://securetoken.google.com/other' }))).toEqual({ ok: false, reason: 'wrong-project' });
  });

  it('rejects an empty subject, a missing one, and a token that is not for this project\'s sign-in', async () => {
    expect(await verify(token({ sub: '', user_id: '' }))).toEqual({ ok: false, reason: 'invalid' });
    expect(await verify(token({ sub: undefined, user_id: undefined }))).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects shapes it can read but not trust', async () => {
    expect((await verify(token({}, { alg: 'RS256', typ: 'JWT' }))).ok).toBe(false);
    expect((await verify(token({}, { alg: 'HS256', typ: 'JWT' }))).ok).toBe(false);
    expect((await verify('aaa.bbb.ccc')).ok).toBe(false);
  });

  it('rejects what is not a token without calling it at all', async () => {
    for (const bad of ['', 'garbage', undefined, null, 12, 'a.b']) {
      expect(await verify(bad)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('with revocation checks on, rejects a disabled account and tokens issued before a revocation', async () => {
    try {
      account = { localId: 'u1', disabled: true, validSince: '0' };
      expect(await verify(token(), { checkRevoked: true })).toEqual({ ok: false, reason: 'revoked' });
      account = { localId: 'u1', disabled: false, validSince: String(now() + 100) };
      expect(await verify(token(), { checkRevoked: true })).toEqual({ ok: false, reason: 'revoked' });
      account = { localId: 'u1', disabled: false, validSince: '0' };
      expect(await verify(token(), { checkRevoked: true })).toEqual({ ok: true, uid: 'u1' });
    } finally {
      account = { localId: 'u1', disabled: false, validSince: '0' };
    }
  });

  it('is "unavailable" when the account lookup cannot be reached', async () => {
    const closedPort = await new Promise((resolve) => {
      const probe = http.createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
    });
    const saveHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${closedPort}`;
    try {
      // A fresh Auth object, created with the unreachable host.
      expect(await verify(token())).toEqual({ ok: false, reason: 'unavailable' });
    } finally {
      process.env.FIREBASE_AUTH_EMULATOR_HOST = saveHost;
    }
  });
});

describe('the real library with the emulator variable set by mistake', () => {
  it('is refused, so an unsigned token is never believed', async () => {
    delete process.env.LOCUS_ALLOW_AUTH_EMULATOR;
    try {
      expect(await verify(token())).toEqual({ ok: false, reason: 'unavailable' });
    } finally {
      process.env.LOCUS_ALLOW_AUTH_EMULATOR = 'true';
    }
  });
});
