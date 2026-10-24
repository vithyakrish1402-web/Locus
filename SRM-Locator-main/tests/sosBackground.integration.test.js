import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as connectIo } from 'socket.io-client';
import { sleep, waitFor } from './helpers/e2eServer.js';

/**
 * An SOS reaching a phone whose app has been swiped away: the real backend/server.js inside this
 * test, the real endpoints over real HTTP, the real identity check (firebase-admin in its offline
 * emulator mode, answered by a stub on localhost), and a Group on real sockets. The "closed phone"
 * is this test calling GET /api/background/sos with a device token, exactly as the Android
 * service does, after its socket is gone.
 */

const SECRET = 'a-long-random-secret-for-the-tests-0123456789';
const PROJECT = 'locus-5c6a8';

let stub;
let server;
let api;
let url;
const clients = [];
let roomSeq = 0;
const saved = {};

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let localId = 'unknown';
      try { localId = JSON.parse(raw).localId[0]; } catch { /* keep the default */ }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ users: [{ localId, disabled: false, validSince: '0' }] }));
    });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const env = {
    PORT: '0',
    LOCUS_BACKGROUND_SHARING_ENABLED: 'true',
    LOCUS_DEVICE_TOKEN_SECRET: SECRET,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${stub.address().port}`,
    LOCUS_ALLOW_AUTH_EMULATOR: 'true',
    LOCUS_BG_MINTS_PER_MIN_UID: '1000',
    LOCUS_BG_MINTS_PER_MIN_IP: '1000',
    LOCUS_BG_SOS_POLL_MAX_WAIT_SEC: '3',
    LOCUS_BG_SOS_POLLS_PER_MIN_TOKEN: '40',
    LOCUS_CLASS_CLOCK_ISO: '2026-01-04T10:00:00Z',
    LOCUS_FORCE_CLASS_HOURS: '',
    // No SOS cooldown here: a second press from the same person is what some of these exercise.
    LOCUS_SOS_COOLDOWN_DEFAULT_MS: '0',
    // A burst of join requests is gathered for this long before admitters are told (joinNotify.js).
    LOCUS_JOIN_NOTIFY_BATCH_MS: '300',
  };
  for (const key of Object.keys(env)) saved[key] = process.env[key];
  Object.assign(process.env, env);
  server = await import('../backend/server.js');
  url = `http://localhost:${await server.listening}`;
  api = `${url}/api/background`;
});

afterEach(() => clients.splice(0).forEach((s) => s.disconnect()));
afterAll(async () => {
  await server.stopServer();
  stub.close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// --- phones on sockets ---
const connect = async () => {
  const socket = connectIo(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  Object.assign(socket, { sos: [], updated: [] });
  socket.on('sos-received', (p) => socket.sos.push(p));
  socket.on('sos-updated', (p) => socket.updated.push(p));
  const keepAlive = setInterval(() => socket.connected && socket.emit('check-ping', Date.now()), 100);
  socket.on('disconnect', () => clearInterval(keepAlive));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  clients.push(socket);
  return socket;
};
const join = (socket, room, uid, extra = {}) => new Promise((resolve) => {
  socket.once('access-granted', (p) => resolve({ outcome: 'granted', ...p }));
  socket.once('access-pending', () => resolve({ outcome: 'pending' }));
  socket.emit('request-join', { roomCode: room, user: { uid, name: uid }, ...extra });
});
const admit = async (owner, socket, room, uid) => {
  const request = new Promise((resolve) => owner.once('access-request', resolve));
  const granted = new Promise((resolve) => socket.once('access-granted', resolve));
  socket.emit('request-join', { roomCode: room, user: { uid, name: uid } });
  const { targetId } = await request;
  owner.emit('resolve-access', { targetId, roomCode: room, approved: true });
  await granted;
};
const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

// uA founds the Group (its Group Lead); uB and uC are members.
const group = async () => {
  const room = `SB${++roomSeq}`;
  const alpha = await connect();
  await join(alpha, room, 'uA', { intent: 'create' });
  const bravo = await connect();
  await admit(alpha, bravo, room, 'uB');
  const charlie = await connect();
  await admit(alpha, charlie, room, 'uC');
  return { room, alpha, bravo, charlie };
};

const press = (socket, room, extra = {}) =>
  socket.emit('sos-broadcast', { senderName: 'Alpha', lat: 12.8231, lng: 80.0442, roomCode: room, timestamp: Date.now(), ...extra });

// --- the phone's side ---
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const idToken = (uid) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: now() - 5, user_id: uid, sub: uid,
  iat: now() - 5, exp: now() + 3600, firebase: { identities: {}, sign_in_provider: 'password' },
})}.`;

const call = async (method, path, { auth, body } = {}) => {
  const res = await fetch(api + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const mint = async (uid, room) => (await call('POST', '/token', { auth: idToken(uid), body: { roomCode: room } }));
const tokenFor = async (uid, room) => (await mint(uid, room)).json.token;
const poll = (token, { after = 0, wait = 0 } = {}) => call('GET', `/sos?after=${after}&wait=${wait}`, { auth: token });
const ack = (token, id) => call('POST', '/sos/ack', { auth: token, body: { id } });
const pollJoin = (token, { joinAfter = 0, wait = 0 } = {}) => call('GET', `/sos?after=0&wait=${wait}&joinAfter=${joinAfter}`, { auth: token });
const knock = async (room, uid) => {
  const s = await connect();
  expect((await join(s, room, uid)).outcome).toBe('pending');
  return s;
};

// Item 13 (2026-10-24): people waiting to join reach the Group's admitters whose app is closed, on
// the same route as the closed-app SOS: one answer per burst, with the total, and a last one when
// nobody is waiting any more. Only for phones that ask (joinAfter); never for plain members.
describe('people waiting to join, for an admitter whose app is closed', () => {
  it('wakes the waiting phone on the first request, then reports the current count', async () => {
    const { room, alpha } = await group();
    const token = await tokenFor('uA', room);
    const baseline = (await pollJoin(token)).json.join?.rev || 0;
    alpha.disconnect();
    const waiting = pollJoin(token, { joinAfter: baseline, wait: 3 });
    await sleep(100);
    const requestedAt = Date.now();
    await knock(room, 'u1');
    const answer = await waiting;
    expect(answer.status).toBe(200);
    expect(answer.json.join.count).toBe(1);
    expect(Date.now() - requestedAt).toBeLessThan(1000);
    await knock(room, 'u2');
    await knock(room, 'u3');
    const latest = (await pollJoin(token)).json.join;
    expect(latest.count).toBe(3);
    expect(latest.rev).toBeGreaterThan(answer.json.join.rev);
    const again = await pollJoin(token, { joinAfter: latest.rev, wait: 1 });
    expect(again.json.join).toBeUndefined();
  });

  it('says when nobody is waiting any more, so the notification can go', async () => {
    const { room, alpha, bravo } = await group();
    const token = await tokenFor('uA', room);
    alpha.disconnect();
    await sleep(100);
    const joiners = [await knock(room, 'u1'), await knock(room, 'u2')];
    await sleep(500); // the burst is gathered, then told
    const pending = (await pollJoin(token)).json.join;
    expect(pending.count).toBe(2);
    // 1.1.74: a stand-in can admit individually; Admit all stays with the Group Lead.
    expect((await ask(bravo, 'admit-all', { roomCode: room })).ok).toBe(false);
    for (const s of joiners) bravo.emit('resolve-access', { targetId: s.id, roomCode: room, approved: true });
    await ask(bravo, 'admit-all', { roomCode: room }); // round trip: approvals have been processed
    const cleared = await pollJoin(token, { joinAfter: pending.rev });
    expect(cleared.json.join.count).toBe(0);
    expect(cleared.json.join.rev).toBeGreaterThan(pending.rev);
  });

  it('reaches moderators too, and never a plain member', async () => {
    const { room, alpha, bravo, charlie } = await group();
    expect(await ask(alpha, 'set-moderator', { roomCode: room, targetId: bravo.id, moderator: true })).toEqual({ ok: true });
    const forMod = await tokenFor('uB', room);
    const forMember = await tokenFor('uC', room);
    bravo.disconnect();
    charlie.disconnect();
    await knock(room, 'u1');
    await sleep(500);
    expect((await pollJoin(forMod)).json.join.count).toBe(1);
    expect((await pollJoin(forMember)).json.join).toBeUndefined();
  });

  it('is never offered to a phone that does not ask for it (the v1.1.61 app)', async () => {
    const { room, alpha } = await group();
    const token = await tokenFor('uA', room);
    alpha.disconnect();
    await knock(room, 'u1');
    await sleep(500);
    const started = Date.now();
    const answer = await poll(token, { wait: 1 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900); // not woken by it either
    expect(answer.json).not.toHaveProperty('join');
  });
});

describe('an SOS reaching a closed app', () => {
  it('is delivered at once to a member whose app was swiped away, while they were waiting', async () => {
    const { room, alpha, bravo } = await group();
    const token = await tokenFor('uB', room);
    bravo.disconnect(); // the app is swiped away: no socket any more

    const waiting = poll(token, { wait: 3 });
    await sleep(150);
    const pressedAt = Date.now();
    press(alpha, room);
    const answer = await waiting;

    expect(Date.now() - pressedAt).toBeLessThan(1000); // woken by the SOS, not by the timeout
    expect(answer.status).toBe(200);
    expect(answer.json.sos).toHaveLength(1);
    expect(answer.json.sos[0]).toMatchObject({ senderName: 'Alpha', senderUid: 'uA', lat: 12.8231, lng: 80.0442 });
    expect(answer.json.sos[0].ageMs).toBeLessThan(1000);
    expect(answer.json.sos[0].id).toBeTruthy();
    expect(answer.json.rev).toBe(answer.json.sos[0].rev);
  });

  it('is also delivered to every other member, and not to the sender', async () => {
    const { room, alpha, bravo, charlie } = await group();
    const tokens = { uA: await tokenFor('uA', room), uB: await tokenFor('uB', room), uC: await tokenFor('uC', room) };
    bravo.disconnect();
    charlie.disconnect();
    const forB = poll(tokens.uB, { wait: 3 });
    const forC = poll(tokens.uC, { wait: 3 });
    const forA = poll(tokens.uA, { wait: 1 });
    await sleep(100);
    press(alpha, room);
    expect((await forB).json.sos).toHaveLength(1);
    expect((await forC).json.sos).toHaveLength(1);
    expect((await forA).json.sos).toEqual([]); // timed out: the sender is never told about their own
  });

  it('catches up at once on an SOS raised before the phone asked', async () => {
    const { room, alpha, bravo } = await group();
    press(alpha, room);
    await waitFor(() => bravo.sos.length);
    const token = await tokenFor('uB', room);
    bravo.disconnect();
    const started = Date.now();
    const answer = await poll(token, { wait: 3 });
    expect(Date.now() - started).toBeLessThan(500); // nothing to wait for
    expect(answer.json.sos).toHaveLength(1);
    expect(answer.json.sos[0].ageMs).toBeGreaterThanOrEqual(0);
  });

  it('is not repeated once the phone has seen it (it asks from the last rev)', async () => {
    const { room, alpha } = await group();
    const token = await tokenFor('uB', room);
    press(alpha, room);
    const first = await poll(token, { wait: 3 });
    expect(first.json.sos).toHaveLength(1);
    const second = await poll(token, { after: first.json.rev, wait: 1 });
    expect(second.json.sos).toEqual([]);
    expect(second.json.rev).toBe(first.json.rev);
  });

  it('a second press from the same person is the same SOS, updated, with a newer rev', async () => {
    const { room, alpha } = await group();
    const token = await tokenFor('uB', room);
    press(alpha, room);
    const first = await poll(token, { wait: 3 });
    const waiting = poll(token, { after: first.json.rev, wait: 3 });
    await sleep(100);
    press(alpha, room, { lat: 12.9, lng: 80.1 });
    const again = (await waiting).json.sos;
    expect(again).toHaveLength(1);
    expect(again[0].id).toBe(first.json.sos[0].id); // the same alert: it replaces, it does not stack
    expect(again[0].rev).toBeGreaterThan(first.json.sos[0].rev);
    expect(again[0]).toMatchObject({ lat: 12.9, lng: 80.1 });
  });

  it('stops being offered once the member acknowledges it, by HTTP or by their app', async () => {
    const { room, alpha, bravo, charlie } = await group();
    const forB = await tokenFor('uB', room);
    const forC = await tokenFor('uC', room);
    press(alpha, room);
    const seen = await poll(forB, { wait: 3 });
    expect(await ack(forB, seen.json.sos[0].id)).toMatchObject({ status: 200, json: { ok: true } });
    expect((await poll(forB, { wait: 0 })).json.sos).toEqual([]);

    // The app, opened and acknowledging on its socket, has the same effect as the service's ack.
    await waitFor(() => charlie.sos.length);
    charlie.emit('sos-ack', { id: charlie.sos[0].id });
    await sleep(150);
    expect((await poll(forC, { wait: 0 })).json.sos).toEqual([]);
    expect(bravo.sos).toHaveLength(1); // Bravo's open app still got the live one, as before
  });

  it('acknowledging nothing, or something that is not there, changes nothing', async () => {
    const { room } = await group();
    const token = await tokenFor('uB', room);
    expect(await ack(token, 'no-such-sos')).toMatchObject({ status: 200, json: { ok: false } });
    expect(await call('POST', '/sos/ack', { auth: token, body: {} })).toMatchObject({ status: 400 });
    expect(await call('POST', '/sos/ack', { auth: token, body: { id: 'x'.repeat(65) } })).toMatchObject({ status: 400 });
  });
});

describe('who can hear an SOS this way', () => {
  it('nobody without a device token', async () => {
    expect((await call('GET', '/sos?wait=0')).status).toBe(401);
    expect((await poll('v1.garbage.garbage')).status).toBe(401);
  });

  it('only someone in the Group: another Group\'s member never sees it', async () => {
    const { room, alpha } = await group();
    const other = await group();
    const outsider = await tokenFor('uB', other.room);
    press(alpha, room);
    await sleep(100);
    expect((await poll(outsider, { wait: 1 })).json.sos).toEqual([]);
    expect((await mint('uStranger', room)).status).toBe(403); // and a stranger cannot get a token at all
  });

  it('not once they have left the Group, not even one who was waiting when they left', async () => {
    const { room, alpha, bravo } = await group();
    const token = await tokenFor('uB', room);
    const waiting = poll(token, { wait: 3 });
    await sleep(100);
    bravo.emit('leave-squad');
    await sleep(100);
    press(alpha, room);
    const answer = await waiting;
    expect(answer.status).toBe(401);
    expect(answer.json.sos).toBeUndefined();
    expect((await poll(token)).status).toBe(401);
  });

  it('not once they are blocked', async () => {
    const { room, alpha, bravo } = await group();
    const token = await tokenFor('uB', room);
    bravo.disconnect();
    await sleep(100);
    alpha.emit('block-user', { roomCode: room, targetId: 'bg:uB' });
    await sleep(150);
    press(alpha, room);
    const answer = await poll(token, { wait: 0 });
    expect(answer.status).toBe(401);
    expect(answer.json.sos).toBeUndefined();
  });

  it('a Group nobody is in any more cannot be listened to', async () => {
    const { room, alpha, bravo, charlie } = await group();
    const token = await tokenFor('uB', room);
    for (const s of [alpha, bravo, charlie]) s.emit('leave-squad');
    await sleep(150);
    expect([401, 410]).toContain((await poll(token)).status); // revoked by leaving (401), or gone (410)
  });
});

describe('what the server\'s own rules still decide', () => {
  it('an SOS the Group Lead\'s switch refuses reaches nobody, closed app or not', async () => {
    const { room, alpha, bravo } = await group();
    const token = await tokenFor('uC', room);
    expect(await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: false })).toEqual({ ok: true });
    const waiting = poll(token, { wait: 1 });
    await sleep(100);
    press(bravo, room);
    const answer = await waiting;
    expect(answer.json.sos).toEqual([]);
    expect(answer.json.rev).toBe(0);

    // And the moment it is switched back on, an SOS goes through.
    await ask(alpha, 'set-group-settings', { roomCode: room, sosEnabled: true });
    press(bravo, room);
    expect((await poll(token, { wait: 3 })).json.sos).toHaveLength(1);
  });
});

describe('the question itself', () => {
  it('is never held open longer than the server allows', async () => {
    const { room } = await group();
    const token = await tokenFor('uB', room);
    const started = Date.now();
    const answer = await poll(token, { wait: 600 });
    const took = Date.now() - started;
    expect(answer.status).toBe(200);
    expect(took).toBeGreaterThanOrEqual(2500);
    expect(took).toBeLessThan(5000); // LOCUS_BG_SOS_POLL_MAX_WAIT_SEC is 3 in this test
  }, 10000);

  it('treats a nonsense cursor or wait as none, and never throws', async () => {
    const { room } = await group();
    const token = await tokenFor('uB', room);
    for (const query of ['after=-5&wait=abc', 'after=1.5&wait=', 'after=%00&wait=-1', 'after[]=1&wait[]=2']) {
      const res = await fetch(`${api}/sos?${query}`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(200);
      expect((await res.json()).sos).toEqual([]);
    }
  });

  it('a phone that goes away mid-wait leaves nothing behind', async () => {
    const { room, alpha } = await group();
    const token = await tokenFor('uB', room);
    const controller = new AbortController();
    const dropped = fetch(`${api}/sos?wait=3`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal }).catch(() => 'aborted');
    await sleep(150);
    controller.abort();
    expect(await dropped).toBe('aborted');
    press(alpha, room); // would have woken the dead wait; must not crash the server
    await sleep(100);
    expect((await poll(token, { wait: 0 })).status).toBe(200);
  });

  it('is rate limited per device token, with a Retry-After', async () => {
    const { room } = await group();
    const token = await tokenFor('uB', room);
    let limited = null;
    for (let i = 0; i < 60 && !limited; i++) {
      const res = await fetch(`${api}/sos?wait=0`, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 429) limited = res;
    }
    expect(limited).not.toBeNull();
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('ordinary pings reaching a closed app', () => {
  it('reaches a member shown under their background presence ID', async () => {
    const { room, alpha, bravo } = await group();
    const token = await tokenFor('uB', room);
    expect((await call('POST', '/location', { auth: token, body: { lat: 12.8231, lng: 80.0442, nextPostWithinSec: 60 } })).status).toBe(200);
    bravo.disconnect();
    const waiting = call('GET', '/sos?pingAfter=0&wait=3', { auth: token });
    await sleep(100);
    alpha.emit('ping-user', { targetId: 'bg:uB' });
    expect((await waiting).json.pings).toEqual([{ rev: expect.any(Number), senderName: 'uA' }]);
  });

  it('wakes only the recipient, preserves sender identity, and advances the cursor', async () => {
    const { room, alpha, bravo } = await group();
    const token = await tokenFor('uB', room);
    const other = await tokenFor('uC', room);
    const targetId = bravo.id;
    bravo.disconnect();
    const waiting = call('GET', '/sos?pingAfter=0&wait=3', { auth: token });
    await sleep(100);
    alpha.emit('ping-user', { targetId, senderName: 'Forged name' });
    const answer = await waiting;
    expect(answer.status).toBe(200);
    expect(answer.json.pings).toHaveLength(1);
    expect(answer.json.pings[0].senderName).toBe('uA');
    expect((await call('GET', '/sos?pingAfter=0', { auth: other })).json.pings).toEqual([]);
    const after = answer.json.pings[0].rev;
    expect((await call('GET', '/sos?pingAfter=' + after, { auth: token })).json.pings).toEqual([]);
    expect((await poll(token)).json).not.toHaveProperty('pings');
  });
});
