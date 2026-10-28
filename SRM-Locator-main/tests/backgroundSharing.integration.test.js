import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as connectIo } from 'socket.io-client';
import { sleep, waitFor } from './helpers/e2eServer.js';

/**
 * Background sharing end to end: the real backend/server.js inside this test, the real
 * endpoints over real HTTP, the real identity check (firebase-admin in its offline emulator
 * mode, answered by a stub on localhost), and a Group of simulated phones on real sockets.
 * A "fake phone" here is just this test calling the endpoints.
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
    LOCUS_BG_MINTS_PER_MIN_UID: '1000', // the rate limits have their own tests; these tests mint a lot
    LOCUS_BG_MINTS_PER_MIN_IP: '1000',
    LOCUS_LEASE_MIN_SEC: '0.4',
    LOCUS_LEASE_MAX_SEC: '1',
    LOCUS_PRESENCE_CHECK_MS: '30',
    LOCUS_SWEEP_INTERVAL_MS: '100',
    LOCUS_EMPTY_GROUP_GRACE_MS: '100', // an empty Group is kept a while for its members; here, briefly
    LOCUS_ROOM_TTL_MS: '600',
    LOCUS_CLASS_CLOCK_ISO: '2026-01-04T10:00:00Z',
    LOCUS_FORCE_CLASS_HOURS: '',
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
  Object.assign(socket, { updates: [], lost: [] });
  socket.on('users-update', (p) => socket.updates.push(p));
  socket.on('member-signal-lost', (p) => socket.lost.push(p));
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
const newest = (socket) => socket.updates[socket.updates.length - 1] ?? {};
const keysOf = (update) => Object.keys(update);

const group = async () => {
  const room = `BG${++roomSeq}`;
  const alpha = await connect();
  await join(alpha, room, 'uA', { intent: 'create' });
  const bravo = await connect();
  await admit(alpha, bravo, room, 'uB');
  const charlie = await connect();
  await admit(alpha, charlie, room, 'uC');
  for (const [s, n] of [[alpha, 'Alpha'], [bravo, 'Bravo'], [charlie, 'Charlie']]) s.emit('update-location', { lat: 12.8222, lng: 80.0436, name: n, roomCode: room, heading: 0, battery: 90 });
  await waitFor(() => keysOf(newest(alpha)).length === 3);
  return { room, alpha, bravo, charlie };
};

// --- the phone's side: a Firebase sign-in (unsigned, which the emulator-mode library accepts) ---
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const idToken = (uid, claims = {}) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: now() - 5, user_id: uid, sub: uid,
  iat: now() - 5, exp: now() + 3600, firebase: { identities: {}, sign_in_provider: 'password' }, ...claims,
})}.`;

const call = async (method, path, { auth, body } = {}) => {
  const res = await fetch(api + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const mint = (uid, room, claims) => call('POST', '/token', { auth: idToken(uid, claims), body: { roomCode: room } });
const report = (token, over = {}) => call('POST', '/location', { auth: token, body: { lat: 12.9, lng: 80.1, nextPostWithinSec: 1, battery: 55, accuracy: 9, ...over } });
const stopSharing = (token) => call('DELETE', '/session', { auth: token });

describe('a phone sharing from the background, seen by the Group', () => {
  it('is on everyone\'s map after the app is swiped away, and lost only when the reports stop and the lease ends', async () => {
    const { room, alpha, bravo, charlie } = await group();
    const minted = await mint('uB', room);
    expect(minted.status).toBe(200);
    const token = minted.json.token;

    const sent = await report(token); // the service is already reporting...
    bravo.disconnect(); // ...when the app is swiped away
    expect(sent).toMatchObject({ status: 200, json: { ok: true, leaseSec: 1 } });

    for (const watcher of [alpha, charlie]) {
      await waitFor(() => keysOf(newest(watcher)).includes('bg:uB'));
      expect(newest(watcher)['bg:uB']).toMatchObject({ uid: 'uB', lat: 12.9, lng: 80.1, battery: 55, accuracy: 9, hasFix: true, presence: true });
    }

    // Reporting every 300 ms for over a second: still there, still no signal-lost.
    const until = Date.now() + 1300;
    let marker = 12.9;
    while (Date.now() < until) {
      marker += 0.0001;
      expect((await report(token, { lat: marker })).status).toBe(200);
      await sleep(300);
    }
    expect(alpha.lost).toEqual([]);
    expect(newest(charlie)['bg:uB'].lat).toBeCloseTo(marker, 4);

    // The reports stop: nothing for a lease's length, and then (only then) signal-lost, to everyone.
    const stopped = Date.now();
    await waitFor(() => alpha.lost.length && charlie.lost.length, { timeout: 3000 });
    expect(Date.now() - stopped).toBeGreaterThanOrEqual(700);
    expect(alpha.lost[0]).toMatchObject({ uid: 'uB', targetId: 'bg:uB' });
    await waitFor(() => !keysOf(newest(alpha)).includes('bg:uB'));
  });

  it('is one marker when their app is also open', async () => {
    const { room, alpha, bravo } = await group();
    const token = (await mint('uB', room)).json.token;
    for (let i = 0; i < 4; i++) {
      await report(token);
      bravo.emit('update-location', { lat: 12.8222, lng: 80.0436, name: 'Bravo', roomCode: room, heading: 0, battery: 90 });
      await sleep(40);
    }
    for (const update of alpha.updates.slice(-6)) {
      expect(Object.values(update).filter((v) => v.uid === 'uB')).toHaveLength(1);
    }
  });

  it('stopping takes them off the map quietly, and the token is finished', async () => {
    const { room, alpha, bravo } = await group();
    const token = (await mint('uB', room)).json.token;
    await report(token);
    bravo.disconnect();
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));

    expect(await stopSharing(token)).toMatchObject({ status: 200, json: { ok: true } });
    await waitFor(() => !keysOf(newest(alpha)).includes('bg:uB'));
    await sleep(1300); // longer than any lease
    expect(alpha.lost).toEqual([]);
    expect(await report(token)).toMatchObject({ status: 401, json: { reason: 'revoked' } });
    expect((await stopSharing(token)).status).toBe(200);
  });

  it('leaving the Group ends it at once', async () => {
    const { room, alpha, bravo } = await group();
    const token = (await mint('uB', room)).json.token;
    await report(token);
    bravo.emit('leave-squad');
    await waitFor(() => !keysOf(newest(alpha)).some((k) => newest(alpha)[k].uid === 'uB'));
    expect(await report(token)).toMatchObject({ status: 401 });
    expect((await mint('uB', room)).status).toBe(403); // no longer admitted
  });

  it('being blocked ends it at once, even with the app closed', async () => {
    const { room, alpha, bravo } = await group();
    const token = (await mint('uB', room)).json.token;
    await report(token);
    bravo.disconnect();
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));
    alpha.emit('block-user', { roomCode: room, targetId: 'bg:uB' });
    await waitFor(() => !keysOf(newest(alpha)).includes('bg:uB'));
    expect((await report(token)).status).toBe(401);
    expect((await mint('uB', room)).status).toBe(403);
    expect(alpha.lost).toEqual([]);
  });

  it('being voted out ends it at once', async () => {
    const { room, alpha, bravo, charlie } = await group();
    const token = (await mint('uB', room)).json.token;
    await report(token);
    bravo.disconnect();
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));
    await sleep(150);
    alpha.emit('vote-to-kick', { roomCode: room, targetId: 'bg:uB' });
    charlie.emit('vote-to-kick', { roomCode: room, targetId: 'bg:uB' });
    await waitFor(() => !keysOf(newest(alpha)).includes('bg:uB'));
    expect((await report(token)).status).toBe(401);
  });

  it('cutting a person off everywhere works', async () => {
    const { room, bravo } = await group();
    const token = (await mint('uB', room)).json.token;
    expect((await report(token)).status).toBe(200);
    expect(server.revokeAllDeviceTokens('uB')).toBe(1);
    expect(server.revokeAllDeviceTokens('uB')).toBe(0);
    expect((await report(token)).status).toBe(401);
    expect(bravo.connected).toBe(true);
  });

  it('does not survive the Group: gone is 410, and a Group founded again under the code is not the same', async () => {
    const { room, alpha, bravo, charlie } = await group();
    const token = (await mint('uB', room)).json.token;
    await report(token);
    alpha.disconnect();
    bravo.disconnect();
    charlie.disconnect();
    await sleep(1600); // the lease ends, the sweep removes the squad
    expect((await report(token)).status).toBe(410);

    const founder = await connect();
    await join(founder, room, 'uB', { intent: 'create' }); // the same person, founding it afresh
    expect(await report(token)).toMatchObject({ status: 401, json: { reason: 'revoked' } });
    expect((await mint('uB', room)).status).toBe(200); // a new token for the new Group
  });
});

describe('who can get a token', () => {
  it('only an admitted member with a good sign-in', async () => {
    const { room } = await group();
    expect((await mint('uStranger', room)).status).toBe(403);
    expect(await mint('uB', room, { exp: now() - 100, iat: now() - 4000 })).toMatchObject({ status: 401, json: { reason: 'expired' } });
    expect(await mint('uB', room, { aud: 'someone-else', iss: 'https://securetoken.google.com/someone-else' })).toMatchObject({ status: 401, json: { reason: 'wrong-project' } });
    expect(await call('POST', '/token', { auth: 'aaa.bbb.ccc', body: { roomCode: room } })).toMatchObject({ status: 401 });
    expect(await call('POST', '/token', { auth: idToken('uB'), body: { roomCode: 'NOSUCH' } })).toMatchObject({ status: 404 });
    expect((await mint('uB', room)).status).toBe(200);
  });

  it('is not given on someone else\'s sign-in: the uid comes from the verified token, never from the request', async () => {
    const { room } = await group();
    const res = await fetch(`${api}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken('uStranger')}` },
      body: JSON.stringify({ roomCode: room, uid: 'uB', userId: 'uB' }),
    });
    expect(res.status).toBe(403);
  });
});
