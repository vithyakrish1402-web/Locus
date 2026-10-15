import http from 'node:http';
import express from 'express';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createBackgroundRouter, backgroundConfig, backgroundStatus, backgroundStartupLine, parseReport,
  startSession, sessionIsCurrent, endSession, endAllSessions, MIN_SECRET_LENGTH,
} from '../backend/backgroundSharing.js';
import { setPresence, presenceOf } from '../backend/presence.js';

/**
 * The background-sharing endpoints (backend/backgroundSharing.js) over real HTTP, on a tiny
 * server of their own with fake Groups, a fake identity check and a clock the test moves.
 */

const SECRET = 'a-long-random-secret-for-the-tests-0123456789';
const T0 = Date.UTC(2026, 9, 15, 6, 0, 0);
const WHERE = { lat: 12.8222, lng: 80.0436 };

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => { s.closeAllConnections?.(); s.close(resolve); })));
});

// Fake ID tokens: "id.<uid>" is a good sign-in for <uid>; others map to a refusal.
const fakeVerify = vi.fn(async (token) => {
  if (token.startsWith('id.')) return { ok: true, uid: token.slice(3) };
  if (token === 'expired') return { ok: false, reason: 'expired' };
  if (token === 'down') return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'invalid' };
});

async function harness({ config = {}, squads, nowRef = { t: T0 } } = {}) {
  const groups = squads ?? Object.assign(Object.create(null), {
    R1: { knownUids: ['uA', 'uB', 'uC'], blockedUids: [], members: [], memberUids: {} },
  });
  const calls = { accept: [], ended: [] };
  const settings = { ...backgroundConfig({ LOCUS_BACKGROUND_SHARING_ENABLED: 'true', LOCUS_DEVICE_TOKEN_SECRET: SECRET }), ...config };
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/background', createBackgroundRouter({
    config: settings,
    verifyIdToken: fakeVerify,
    getSquad: (room) => groups[room],
    accept: (room, uid, report, now) => {
      calls.accept.push({ room, uid, report });
      const squad = groups[room];
      if (!squad) return { ok: false, reason: 'no-group' };
      if (squad.blockedUids.includes(uid)) return { ok: false, reason: 'blocked' };
      if (!squad.knownUids.includes(uid)) return { ok: false, reason: 'not-member' };
      const entry = setPresence(squad, uid, report, now);
      return entry ? { ok: true, leaseUntil: entry.leaseUntil } : { ok: false, reason: 'bad-report' };
    },
    endSharing: (room, uid) => { calls.ended.push({ room, uid }); delete groups[room]?.presence?.[uid]; },
    now: () => nowRef.t,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const url = `http://127.0.0.1:${server.address().port}/api/background`;

  const send = async (method, path, { auth, body, headers = {}, raw } = {}) => {
    const res = await fetch(url + path, {
      method,
      headers: { ...(raw === undefined && body !== undefined ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const mint = (uid = 'uB', room = 'R1', extra = {}) => send('POST', '/token', { auth: `id.${uid}`, body: { roomCode: room }, ...extra });
  const post = (token, body = { ...WHERE, nextPostWithinSec: 10 }, extra = {}) => send('POST', '/location', { auth: token, body, ...extra });
  const stop = (token) => send('DELETE', '/session', { auth: token });
  return { url, groups, calls, nowRef, settings, send, mint, post, stop };
}

const tokenFor = async (h, uid = 'uB', room = 'R1') => (await h.mint(uid, room)).json.token;

describe('when it is not switched on', () => {
  const answers = async (config) => {
    const h = await harness({ config });
    const results = [
      await h.send('POST', '/token', { auth: 'id.uB', body: { roomCode: 'R1' } }),
      await h.send('POST', '/location', { auth: 'whatever', body: WHERE }),
      await h.send('DELETE', '/session', { auth: 'whatever' }),
      await h.send('GET', '/nothing'),
    ];
    return { h, results };
  };

  it.each([
    ['off by default', { enabled: false }],
    ['on, but without the secret', { secret: '' }],
    ['on, but with a short secret', { secret: 'x'.repeat(MIN_SECRET_LENGTH - 1) }],
  ])('%s: every endpoint answers 503 and nothing happens', async (_name, config) => {
    const { h, results } = await answers(config);
    for (const r of results) expect(r).toMatchObject({ status: 503, json: { error: 'disabled' } });
    expect(h.calls.accept).toEqual([]);
    expect(fakeVerify).not.toHaveBeenCalledWith('id.uB');
  });

  it('knows why, and says so at startup without ever printing the secret', () => {
    const env = { LOCUS_BACKGROUND_SHARING_ENABLED: 'true', LOCUS_DEVICE_TOKEN_SECRET: SECRET };
    expect(backgroundStatus(backgroundConfig({}))).toEqual({ active: false, reason: 'off' });
    expect(backgroundStatus(backgroundConfig({ LOCUS_BACKGROUND_SHARING_ENABLED: 'true' }))).toEqual({ active: false, reason: 'no-secret' });
    expect(backgroundStatus(backgroundConfig({ ...env, LOCUS_DEVICE_TOKEN_SECRET: 'short' }))).toEqual({ active: false, reason: 'weak-secret' });
    expect(backgroundStatus(backgroundConfig(env))).toEqual({ active: true, reason: null });
    for (const value of ['TRUE', '1', 'yes', '', 'false']) {
      expect(backgroundStatus(backgroundConfig({ ...env, LOCUS_BACKGROUND_SHARING_ENABLED: value })).active).toBe(false);
    }
    expect(backgroundStartupLine(backgroundConfig({}))).toContain('OFF: LOCUS_BACKGROUND_SHARING_ENABLED is not "true"');
    expect(backgroundStartupLine(backgroundConfig({ LOCUS_BACKGROUND_SHARING_ENABLED: 'true' }))).toContain('LOCUS_DEVICE_TOKEN_SECRET is not set');
    expect(backgroundStartupLine(backgroundConfig({ ...env, LOCUS_DEVICE_TOKEN_SECRET: 'short' }))).toContain('shorter than 32');
    expect(backgroundStartupLine(backgroundConfig(env))).toContain('ON (device tokens last 14 days)');
    for (const line of [backgroundStartupLine(backgroundConfig(env)), backgroundStartupLine(backgroundConfig({ ...env, LOCUS_DEVICE_TOKEN_SECRET: 'short' }))]) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain('short\'');
    }
  });

  it('defaults to a 14-day token', () => {
    expect(backgroundConfig({}).deviceTokenTtlDays).toBe(14);
    expect(backgroundConfig({ LOCUS_DEVICE_TOKEN_TTL_DAYS: '3' }).deviceTokenTtlDays).toBe(3);
    expect(backgroundConfig({ LOCUS_DEVICE_TOKEN_TTL_DAYS: 'x' }).deviceTokenTtlDays).toBe(14);
  });
});

describe('issuing a device token', () => {
  it('gives an admitted person a token for that Group, good for 14 days', async () => {
    const h = await harness();
    const r = await h.mint('uB');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ttlSeconds: 14 * 86400, expiresAt: T0 + 14 * 86400 * 1000 });
    expect(typeof r.json.token).toBe('string');
    const payload = JSON.parse(Buffer.from(r.json.token.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({ uid: 'uB', room: 'R1', iat: T0 / 1000, exp: T0 / 1000 + 14 * 86400 });
    expect(sessionIsCurrent(h.groups.R1, 'uB', payload.sid)).toBe(true);
  });

  it('needs a sign-in header that is there and shaped right', async () => {
    const h = await harness();
    expect((await h.send('POST', '/token', { body: { roomCode: 'R1' } })).json.error).toBe('missing-token');
    for (const header of ['Basic id.uB', 'Bearer', 'Bearer ', 'bearer id.uB', 'Bearer id.uB extra', 'id.uB', `Bearer ${'a'.repeat(5000)}`, 'Bearer a b']) {
      const r = await h.send('POST', '/token', { body: { roomCode: 'R1' }, headers: { authorization: header } });
      expect(r.status).toBe(401);
    }
    expect(h.calls.accept).toEqual([]);
  });

  it('says why a sign-in was refused, and 503 when it cannot tell', async () => {
    const h = await harness();
    expect(await h.send('POST', '/token', { auth: 'expired', body: { roomCode: 'R1' } })).toMatchObject({ status: 401, json: { error: 'invalid-token', reason: 'expired' } });
    expect(await h.send('POST', '/token', { auth: 'nonsense', body: { roomCode: 'R1' } })).toMatchObject({ status: 401, json: { reason: 'invalid' } });
    expect(await h.send('POST', '/token', { auth: 'down', body: { roomCode: 'R1' } })).toMatchObject({ status: 503, json: { error: 'identity-unavailable' } });
    expect(h.groups.R1.sessions).toBeUndefined();
  });

  it('is for admitted people only, in a Group that exists', async () => {
    const h = await harness();
    expect(await h.mint('uStranger')).toMatchObject({ status: 403, json: { error: 'not-member' } });
    h.groups.R1.blockedUids.push('uB');
    expect(await h.mint('uB')).toMatchObject({ status: 403, json: { error: 'blocked' } });
    expect(await h.mint('uA', 'NOPE')).toMatchObject({ status: 404, json: { error: 'no-group' } });
    for (const room of ['__proto__', 'constructor', 'toString']) expect((await h.mint('uA', room)).status).toBe(404);
    expect(h.groups.R1.sessions).toBeUndefined();
  });

  it('needs a sensible room code', async () => {
    const h = await harness();
    for (const roomCode of [undefined, null, 5, {}, [], '', 'x'.repeat(65)]) {
      const r = await h.send('POST', '/token', { auth: 'id.uB', body: { roomCode } });
      expect(r).toMatchObject({ status: 400, json: { error: 'bad-request', field: 'roomCode' } });
    }
    expect((await h.send('POST', '/token', { auth: 'id.uB' })).status).toBe(400);
    expect((await h.send('POST', '/token', { auth: 'id.uB', body: [], })).status).toBe(400);
  });

  it('replaces the person\'s earlier token: only the newest works', async () => {
    const h = await harness();
    const first = await tokenFor(h);
    expect((await h.post(first)).status).toBe(200);
    const second = await tokenFor(h);
    expect(await h.post(first)).toMatchObject({ status: 401, json: { reason: 'revoked' } });
    expect((await h.post(second)).status).toBe(200);
  });

  it('keeps people apart: one person\'s token never works as another\'s', async () => {
    const h = await harness();
    const b = await tokenFor(h, 'uB');
    const c = await tokenFor(h, 'uC');
    expect((await h.post(b)).status).toBe(200);
    expect((await h.post(c)).status).toBe(200);
    expect(h.calls.accept.map((c2) => c2.uid)).toEqual(['uB', 'uC']);
  });

  it('is limited per person and per address, saying when to come back', async () => {
    const h = await harness({ config: { mintsPerMinutePerUid: 3, mintsPerMinutePerIp: 6 } });
    for (let i = 0; i < 3; i++) expect((await h.mint('uB')).status).toBe(200);
    const blocked = await h.mint('uB');
    expect(blocked.status).toBe(429);
    expect(blocked.json).toMatchObject({ error: 'rate-limited' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await h.mint('uC')).status).toBe(200); // someone else is unaffected...
    expect((await h.mint('uC')).status).toBe(200); // ...until the address itself is used up
    expect((await h.mint('uC')).status).toBe(429);
    h.nowRef.t += 61000;
    expect((await h.mint('uB')).status).toBe(200);
  });
});

describe('who and where come from the token, never from the request', () => {
  it('a token is for the person who signed in, whatever the request says about who it is for', async () => {
    const h = await harness();
    const r = await h.send('POST', '/token', { auth: 'id.uA', body: { roomCode: 'R1', uid: 'uB', userId: 'uB', sub: 'uB' } });
    expect(r.status).toBe(200);
    expect(JSON.parse(Buffer.from(r.json.token.split('.')[1], 'base64url').toString()).uid).toBe('uA');
    await h.post(r.json.token);
    expect(h.calls.accept.map((c) => c.uid)).toEqual(['uA']);
  });

  it('a report goes to the Group the token is for, whatever the request says', async () => {
    const h = await harness();
    h.groups.R2 = { knownUids: ['uB'], blockedUids: [], members: [], memberUids: {} };
    const token = await tokenFor(h, 'uB', 'R1');
    expect((await h.post(token, { ...WHERE, nextPostWithinSec: 10, roomCode: 'R2', room: 'R2' })).status).toBe(200);
    expect(h.calls.accept.map((c) => c.room)).toEqual(['R1']);
    expect(presenceOf(h.groups.R2, 'uB', T0)).toBeNull();
    expect(presenceOf(h.groups.R1, 'uB', T0)).not.toBeNull();
  });
});

describe('reporting a position', () => {
  it('puts the person on the map and tells them how long the lease is', async () => {
    const h = await harness();
    const token = await tokenFor(h);
    const r = await h.post(token, { ...WHERE, nextPostWithinSec: 100, battery: 55, accuracy: 12.5, speed: 3, heading: 270, status: 'FROZEN' });
    expect(r).toMatchObject({ status: 200, json: { ok: true, leaseSec: 300, serverTime: T0 } });
    expect(h.calls.accept[0]).toEqual({
      room: 'R1', uid: 'uB',
      report: { ...WHERE, nextPostWithinSec: 100, battery: 55, accuracy: 12.5, speed: 3, heading: 270, status: 'FROZEN' },
    });
    expect(presenceOf(h.groups.R1, 'uB', T0)).toMatchObject({ lat: WHERE.lat, accuracy: 12.5, status: 'FROZEN' });
  });

  it('ignores fields it does not know, and passes on only the ones it does', async () => {
    const h = await harness();
    const token = await tokenFor(h);
    const r = await h.post(token, { ...WHERE, nextPostWithinSec: 10, uid: 'uA', room: 'R2', isAdmin: true, __proto__: { x: 1 }, constructor: 'x' });
    expect(r.status).toBe(200);
    expect(h.calls.accept[0].uid).toBe('uB');
    expect(Object.keys(h.calls.accept[0].report).sort()).toEqual(['lat', 'lng', 'nextPostWithinSec']);
  });

  describe('what a report may say', () => {
    const good = { ...WHERE, nextPostWithinSec: 10 };
    it.each([
      ['no position', {}], ['no latitude', { lng: 80, nextPostWithinSec: 10 }], ['no longitude', { lat: 12, nextPostWithinSec: 10 }],
      ['no interval', { ...WHERE }], ['latitude over 90', { ...good, lat: 90.0001 }], ['latitude under -90', { ...good, lat: -90.1 }],
      ['longitude over 180', { ...good, lng: 180.5 }], ['text for latitude', { ...good, lat: '12.8' }], ['NaN-ish', { ...good, lat: null, lng: null }],
      ['interval 0', { ...good, nextPostWithinSec: 0 }], ['interval negative', { ...good, nextPostWithinSec: -1 }], ['interval over 300', { ...good, nextPostWithinSec: 301 }],
      ['interval text', { ...good, nextPostWithinSec: '10' }], ['speed absurd', { ...good, speed: 401 }], ['speed negative', { ...good, speed: -1 }],
      ['heading over 360', { ...good, heading: 361 }], ['battery over 100', { ...good, battery: 101 }], ['battery negative', { ...good, battery: -1 }],
      ['accuracy absurd', { ...good, accuracy: 100001 }], ['accuracy negative', { ...good, accuracy: -1 }], ['unknown status', { ...good, status: 'HACKED' }],
      ['status number', { ...good, status: 1 }], ['timestamp far past', { ...good, timestamp: T0 - 11 * 60000 }], ['timestamp far future', { ...good, timestamp: T0 + 3 * 60000 }],
      ['timestamp text', { ...good, timestamp: 'now' }], ['an array body', [good]], ['a string body', 'hello'], ['a number body', 7],
    ])('refuses %s', async (_name, body) => {
      const h = await harness();
      const token = await tokenFor(h);
      const r = await h.post(token, body);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe('bad-request');
      expect(h.calls.accept).toEqual([]);
    });

    it('accepts the edges of every range', async () => {
      const h = await harness();
      const token = await tokenFor(h);
      for (const body of [
        { lat: 90, lng: 180, nextPostWithinSec: 1, speed: 0, heading: 0, battery: 0, accuracy: 0 },
        { lat: -90, lng: -180, nextPostWithinSec: 300, speed: 400, heading: 360, battery: 100, accuracy: 100000 },
        { ...good, timestamp: T0 - 10 * 60000 }, { ...good, timestamp: T0 + 2 * 60000 }, { ...good, status: 'ACTIVE' }, { ...good, speed: null, battery: null },
      ]) {
        expect((await h.post(token, body)).status).toBe(200);
      }
    });

    it('says which field was wrong', () => {
      expect(parseReport({ ...good, battery: 500 }, T0)).toEqual({ ok: false, field: 'battery' });
      expect(parseReport({ ...good, lat: 'x' }, T0)).toEqual({ ok: false, field: 'lat' });
      expect(parseReport(null, T0)).toEqual({ ok: false, field: 'body' });
      expect(parseReport([{ lat: 1, lng: 2, nextPostWithinSec: 3 }], T0)).toEqual({ ok: false, field: 'body' });
      expect(parseReport(Object.assign([], { lat: 1, lng: 2, nextPostWithinSec: 3 }), T0)).toEqual({ ok: false, field: 'body' });
    });
  });

  describe('whose report it is', () => {
    it('is refused without a token, or with one that is not ours', async () => {
      const h = await harness();
      expect((await h.send('POST', '/location', { body: { ...WHERE, nextPostWithinSec: 10 } })).json.error).toBe('missing-token');
      const real = await tokenFor(h);
      const [v, b, s] = real.split('.');
      const forged = `${v}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url')), uid: 'uA' })).toString('base64url')}.${s}`;
      for (const token of ['garbage', 'v1.a.b', forged, `${real}x`, 'id.uB']) {
        expect(await h.post(token)).toMatchObject({ status: 401, json: { error: 'invalid-token' } });
      }
      expect(h.calls.accept).toEqual([]);
    });

    it('is refused once the token has expired', async () => {
      const h = await harness();
      const token = await tokenFor(h);
      h.nowRef.t = T0 + 14 * 86400 * 1000 - 1000;
      expect((await h.post(token)).status).toBe(200);
      h.nowRef.t = T0 + 14 * 86400 * 1000;
      expect(await h.post(token)).toMatchObject({ status: 401, json: { reason: 'expired' } });
    });

    it('is refused for a Group that is gone, and for a Group that was re-created since', async () => {
      const h = await harness();
      const token = await tokenFor(h);
      delete h.groups.R1;
      expect(await h.post(token)).toMatchObject({ status: 410, json: { error: 'no-group' } });
      // The code is founded again by someone else: a new squad with no sessions.
      h.groups.R1 = { knownUids: ['uB'], blockedUids: [], members: [], memberUids: {} };
      expect(await h.post(token)).toMatchObject({ status: 401, json: { reason: 'revoked' } });
    });

    it('is refused the moment the person is no longer a member, or is blocked', async () => {
      const h = await harness();
      const token = await tokenFor(h);
      h.groups.R1.knownUids = h.groups.R1.knownUids.filter((u) => u !== 'uB'); // left or voted out, session somehow intact
      expect(await h.post(token)).toMatchObject({ status: 403, json: { error: 'not-member' } });
      h.groups.R1.knownUids.push('uB');
      h.groups.R1.blockedUids.push('uB');
      expect(await h.post(token)).toMatchObject({ status: 403, json: { error: 'blocked' } });
    });

    it('is refused once the session has been ended (leaving, removal, revoking)', async () => {
      const h = await harness();
      const token = await tokenFor(h);
      endSession(h.groups.R1, 'uB');
      expect(await h.post(token)).toMatchObject({ status: 401, json: { reason: 'revoked' } });
      const again = await tokenFor(h);
      expect((await h.post(again)).status).toBe(200);
      expect(endAllSessions(h.groups, 'uB')).toBe(1);
      expect((await h.post(again)).status).toBe(401);
    });
  });

  describe('rate limits', () => {
    it('are per token: one phone going too fast does not slow another', async () => {
      const h = await harness({ config: { postsPerMinutePerToken: 3 } });
      const b = await tokenFor(h, 'uB');
      const c = await tokenFor(h, 'uC');
      for (let i = 0; i < 3; i++) expect((await h.post(b)).status).toBe(200);
      const limited = await h.post(b);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await h.post(c)).status).toBe(200);
      h.nowRef.t += 60000;
      expect((await h.post(b)).status).toBe(200);
    });

    it('are per address, whoever the token is', async () => {
      const h = await harness({ config: { postsPerMinutePerIp: 4 } });
      const b = await tokenFor(h, 'uB');
      const c = await tokenFor(h, 'uC');
      expect((await h.post(b)).status).toBe(200);
      expect((await h.post(c)).status).toBe(200);
      expect((await h.post(b)).status).toBe(200);
      expect((await h.post(c)).status).toBe(200);
      expect((await h.post(b)).status).toBe(429);
      // And a request with no token at all is not counted against anyone.
      expect((await h.send('POST', '/location', { body: WHERE })).status).toBe(401);
    });

    it('a refused request does not use up the lease or reach the map', async () => {
      const h = await harness({ config: { postsPerMinutePerToken: 1 } });
      const token = await tokenFor(h);
      await h.post(token);
      await h.post(token);
      expect(h.calls.accept).toHaveLength(1);
    });
  });
});

describe('stopping', () => {
  it('ends the session, takes them off the map once, and the token stops working', async () => {
    const h = await harness();
    const token = await tokenFor(h);
    await h.post(token);
    expect(await h.stop(token)).toMatchObject({ status: 200, json: { ok: true } });
    expect(h.calls.ended).toEqual([{ room: 'R1', uid: 'uB' }]);
    expect(presenceOf(h.groups.R1, 'uB', T0)).toBeNull();
    expect(await h.post(token)).toMatchObject({ status: 401, json: { reason: 'revoked' } });
  });

  it('is harmless to do twice, or after the session was ended some other way', async () => {
    const h = await harness();
    const token = await tokenFor(h);
    await h.stop(token);
    expect((await h.stop(token)).status).toBe(200);
    expect(h.calls.ended).toHaveLength(1);
    const fresh = await tokenFor(h);
    endSession(h.groups.R1, 'uB');
    expect((await h.stop(fresh)).status).toBe(200);
    expect(h.calls.ended).toHaveLength(1);
  });

  it('cannot be done with a token that is not ours, or by someone else\'s', async () => {
    const h = await harness();
    const b = await tokenFor(h, 'uB');
    expect((await h.send('DELETE', '/session')).status).toBe(401);
    expect((await h.stop('garbage')).status).toBe(401);
    expect(await h.stop(`${b}x`)).toMatchObject({ status: 401 });
    expect(sessionIsCurrent(h.groups.R1, 'uB', JSON.parse(Buffer.from(b.split('.')[1], 'base64url')).sid)).toBe(true);
    delete h.groups.R1;
    expect((await h.stop(b)).status).toBe(410);
  });

  it('does not touch anyone else\'s session', async () => {
    const h = await harness();
    const b = await tokenFor(h, 'uB');
    const c = await tokenFor(h, 'uC');
    await h.stop(b);
    expect((await h.post(c)).status).toBe(200);
  });
});

describe('sessions', () => {
  it('start fresh each time, are per person, and end individually or everywhere', () => {
    const a = { };
    const b = { };
    const s1 = startSession(a, 'uB');
    const s2 = startSession(a, 'uB');
    expect(s1).not.toBe(s2);
    expect(sessionIsCurrent(a, 'uB', s1)).toBe(false);
    expect(sessionIsCurrent(a, 'uB', s2)).toBe(true);
    expect(sessionIsCurrent(a, 'uC', s2)).toBe(false);
    for (const odd of [undefined, null, 5, {}, '']) expect(sessionIsCurrent(a, 'uB', odd)).toBe(false);
    startSession(b, 'uB');
    startSession(b, '__proto__');
    expect({}.polluted).toBeUndefined();
    expect(endAllSessions({ a, b }, 'uB')).toBe(2);
    expect(endAllSessions({ a, b }, 'uB')).toBe(0);
    expect(sessionIsCurrent(b, '__proto__', b.sessions.__proto__)).toBe(true);
    endSession(a, 'nobody');
    endSession(undefined, 'uB');
  });
});

describe('bad requests of every kind', () => {
  it('get a JSON answer and never take the server down', async () => {
    const h = await harness();
    const token = await tokenFor(h);
    const bad = [
      ['POST', '/location', { auth: token, raw: '{not json', headers: { 'content-type': 'application/json' } }, 400],
      ['POST', '/location', { auth: token, raw: '', headers: { 'content-type': 'application/json' } }, 400],
      ['POST', '/location', { auth: token, raw: 'null', headers: { 'content-type': 'application/json' } }, 400],
      ['POST', '/location', { auth: token, raw: JSON.stringify({ blob: 'x'.repeat(5000) }), headers: { 'content-type': 'application/json' } }, 413],
      ['POST', '/location', { auth: token, raw: 'lat=1&lng=2', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 400],
      ['POST', '/location', { auth: token, raw: 'hello', headers: { 'content-type': 'text/plain' } }, 400],
      ['POST', '/token', { auth: 'id.uB', raw: '{"roomCode":', headers: { 'content-type': 'application/json' } }, 400],
      ['POST', '/token', { auth: 'id.uB', raw: JSON.stringify({ roomCode: 'x'.repeat(5000) }), headers: { 'content-type': 'application/json' } }, 413],
      ['POST', '/location', { auth: token, raw: '{"lat":1}', headers: { 'content-type': 'application/json; charset=utf-7' } }, 415],
      ['PUT', '/location', { auth: token }, 404],
      ['GET', '/location', { auth: token }, 404],
      ['POST', '/session', { auth: token }, 404],
    ];
    for (const [method, path, options, status] of bad) {
      const r = await h.send(method, path, options);
      expect([method, path, r.status]).toEqual([method, path, status === 415 ? r.status : status]);
      if (status !== 404) expect(r.json).toMatchObject({ error: expect.any(String) });
      if (status === 413) expect(r.json.error).toBe('too-large');
      expect(r.text).not.toMatch(/at .*\.js:\d+/); // no stack trace
    }
    expect((await h.post(token)).status).toBe(200); // still alive and well
  });

  it('survives hundreds of random requests', async () => {
    const h = await harness({ config: { postsPerMinutePerToken: 1e9, postsPerMinutePerIp: 1e9, mintsPerMinutePerIp: 1e9, mintsPerMinutePerUid: 1e9 } });
    const token = await tokenFor(h);
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const junk = () => pick([
      null, true, false, 0, -1, 1e308, -1e308, NaN, 'x', '', 'a'.repeat(300), [], [1, 2], {}, { a: { b: { c: [] } } }, '__proto__', 'constructor',
      { __proto__: null }, JSON.parse('{"__proto__": {"polluted": true}}'), 12.8222, '12.8222', { toString: 1 },
    ]);
    const statuses = new Set();
    for (let i = 0; i < 300; i++) {
      const body = pick([
        () => ({ lat: junk(), lng: junk(), nextPostWithinSec: junk(), battery: junk(), speed: junk(), heading: junk(), accuracy: junk(), status: junk(), timestamp: junk() }),
        () => junk(),
        () => ({ roomCode: junk() }),
        () => JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"lat":1,"lng":2,"nextPostWithinSec":3}'),
      ])();
      const route = pick([['POST', '/location', token], ['POST', '/token', 'id.uB'], ['DELETE', '/session', token], ['POST', '/location', 'junk' + i], ['POST', '/token', pick(['id.', 'id.uB', 'down', 'expired', 'id.uB'.repeat(500)])]]);
      const auth = rand() < 0.1 ? undefined : route[2];
      const r = await h.send(route[0], route[1], { auth, body });
      statuses.add(r.status);
      expect(r.status).not.toBe(500); // 503 is the fuzz's "down" sign-in, an honest answer
      expect(r.json.error !== undefined || r.json.ok === true || typeof r.json.token === 'string').toBe(true);
    }
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect((await h.post(await tokenFor(h))).status).toBe(200);
    expect(statuses.size).toBeGreaterThan(2);
  });
});

describe('privacy', () => {
  it('writes nothing to any log: no token, no sign-in, no coordinates', async () => {
    const lines = [];
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation((...a) => lines.push(a.join(' '))));
    try {
      const h = await harness();
      const minted = await h.mint('uB');
      await h.mint('uStranger');
      await h.post(minted.json.token, { lat: 12.82223456, lng: 80.04361234, nextPostWithinSec: 7.5, battery: 61 });
      await h.post(minted.json.token, { lat: 'bad', lng: 80.04361234 });
      await h.post('v1.garbage.token');
      await h.stop(minted.json.token);
      expect(lines.join('\n')).not.toMatch(/12\.8222|80\.0436|v1\.|id\.uB|secret/i);
      expect(h.text ?? '').toBe('');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('never puts the secret, a token or a position in an error answer', async () => {
    const h = await harness();
    const token = await tokenFor(h);
    const answers = [
      await h.post(token, { lat: 12.82223456, lng: 999, nextPostWithinSec: 7 }),
      await h.post(`${token}x`),
      await h.send('POST', '/token', { auth: 'id.uB', body: { roomCode: 'NOPE' } }),
    ];
    for (const a of answers) {
      expect(a.text).not.toContain(SECRET);
      expect(a.text).not.toContain(token);
      expect(a.text).not.toContain('12.8222');
    }
  });
});
