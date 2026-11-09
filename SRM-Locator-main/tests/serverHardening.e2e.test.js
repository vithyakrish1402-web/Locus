import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { e2eServer, sleep, waitFor, settle, once } from './helpers/e2eServer.js';

/**
 * End-to-end checks for the server hardening batch (security audit leads F-05, F-06, F-07, F-13,
 * F-14, F-18). The real backend/server.js and real sockets. Limits are tested with small numbers,
 * passed through the environment; nothing is flooded.
 *
 * Sign-in tokens: the server is started in the Firebase library's emulator mode, where it accepts
 * UNSIGNED tokens and asks one account-lookup of a stub on localhost (as identity.sdk.test.js does),
 * with LOCUS_SOCKET_AUTH=require as on Render. So a join here is verified by the real library.
 */

const PROJECT = 'locus-5c6a8';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);
const tokenFor = (uid, claims = {}) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: nowSec() - 10, user_id: uid, sub: uid,
    iat: nowSec() - 10, exp: nowSec() + 3600, firebase: { identities: {}, sign_in_provider: 'password' }, ...claims,
  })}.`;

let stub;
const authEnv = {};
beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let localId = 'x';
      try { localId = JSON.parse(body).localId?.[0] ?? 'x'; } catch { /* a stub: any body will do */ }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ users: [{ localId, disabled: false, validSince: '0' }] }));
    });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  Object.assign(authEnv, {
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${stub.address().port}`,
    LOCUS_ALLOW_AUTH_EMULATOR: 'true',
    LOCUS_SOCKET_AUTH: 'require',
  });
});
afterAll(() => stub?.close());

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const collect = (socket, event) => {
  const seen = [];
  socket.on(event, (p) => seen.push(p ?? {}));
  return seen;
};
const withinAMoment = (promise, ms = 400) => Promise.race([promise, sleep(ms).then(() => 'nothing')]);

// ---------------------------------------------------------------------------------------------
describe('the name shown for a member (F-05)', () => {
  const api = e2eServer({ env: authEnv });
  const PHOTO = 'https://api.dicebear.com/7.x/bottts/svg?seed=Bravo';

  // Alpha founds a Group; Bravo (token name 'Bravo K') asks to join with a client-side name that
  // claims to be somebody else, and is admitted.
  const setUp = async ({ bravoClaims = { name: 'Bravo K' }, claimedName = "Dean's Office" } = {}) => {
    const room = api.newRoom();
    const alpha = await api.connect();
    const created = once(alpha, 'access-granted');
    alpha.emit('request-join', { roomCode: room, user: { uid: 'uA', name: 'Alpha' }, idToken: tokenFor('uA', { name: 'Alpha Lead' }) });
    await created;
    const knocks = collect(alpha, 'access-request');
    const bravo = await api.connect();
    const granted = once(bravo, 'access-granted');
    bravo.emit('request-join', { roomCode: room, user: { uid: 'uB', name: claimedName, photo: PHOTO }, idToken: tokenFor('uB', bravoClaims) });
    await waitFor(() => knocks.length);
    alpha.emit('resolve-access', { targetId: knocks[0].targetId, roomCode: room, approved: true });
    await granted;
    return { room, alpha, bravo, knock: knocks[0] };
  };

  it('is the name the sign-in vouches for in the join request, not the one the phone sends', async () => {
    const { knock } = await setUp();
    expect(knock.name).toBe('Bravo K');
  });

  it('is the name the sign-in vouches for in an SOS, whatever senderName says, and in a later sos-sync', async () => {
    const { room, alpha, bravo } = await setUp();
    bravo.emit('sos-broadcast', { roomCode: room, senderName: "Dean's Office", lat: 12.82, lng: 80.04, clientId: 'c1' });
    await waitFor(() => alpha.sos.length === 1);
    expect(alpha.sos[0].senderName).toBe('Bravo K');

    // Someone admitted afterwards is caught up by sos-sync, with the same name.
    const knocks = collect(alpha, 'access-request');
    const charlie = await api.connect();
    const granted = once(charlie, 'access-granted');
    charlie.emit('request-join', { roomCode: room, user: { uid: 'uC', name: 'Charlie' }, idToken: tokenFor('uC', { name: 'Charlie P' }) });
    await waitFor(() => knocks.length);
    alpha.emit('resolve-access', { targetId: knocks[0].targetId, roomCode: room, approved: true });
    await granted;
    charlie.emit('sos-sync');
    await waitFor(() => charlie.sos.length === 1);
    expect(charlie.sos[0].senderName).toBe('Bravo K');
  });

  it('is the name the sign-in vouches for in the member list, whatever a position report says', async () => {
    const { room, alpha, bravo } = await setUp();
    const lists = collect(alpha, 'users-update');
    bravo.emit('update-location', { roomCode: room, lat: 12.82, lng: 80.04, name: 'Group Lead', photo: 'https://tracker.example/pixel.gif', speed: 0, battery: 50, heading: 0, status: 'ACTIVE' });
    await waitFor(() => lists.some((l) => l[bravo.id]?.lat === 12.82));
    const entry = lists.find((l) => l[bravo.id]?.lat === 12.82)[bravo.id];
    expect(entry.name).toBe('Bravo K');
    expect(entry.photo).toBeNull(); // and the tracking-pixel photo was dropped (F-13)
  });

  it('is the start of the email when the token has no display name, else "Member"', async () => {
    expect((await setUp({ bravoClaims: { email: 'ab1234@srmist.edu.in' } })).knock.name).toBe('ab1234');
    expect((await setUp({ bravoClaims: {} })).knock.name).toBe('Member');
  });

  it('keeps an allowed photo and drops a look-alike host from the join request', async () => {
    const good = await setUp();
    expect(good.knock.photo).toBe(PHOTO);
    const knocks = collect(good.alpha, 'access-request');
    const sneaky = await api.connect();
    sneaky.emit('request-join', { roomCode: good.room, user: { uid: 'uS', name: 'S', photo: 'https://api.dicebear.com.evil.com/x' }, idToken: tokenFor('uS', { name: 'Sneaky' }) });
    await waitFor(() => knocks.length);
    expect(knocks[0]).toMatchObject({ name: 'Sneaky', photo: null });
  });
});

// ---------------------------------------------------------------------------------------------
describe('the waiting room is capped (F-06)', () => {
  const api = e2eServer({ env: { LOCUS_MAX_PENDING_PER_SQUAD: '3' } });

  it('refuses the request after the cap, and takes one again once an answer makes room', async () => {
    const room = api.newRoom();
    const alpha = await api.connect();
    await api.createSquad(alpha, room, 'uA');
    const knocks = collect(alpha, 'access-request');
    const strangers = [];
    for (const uid of ['u1', 'u2', 'u3']) {
      const s = await api.connect();
      const pending = once(s, 'access-pending');
      s.emit('request-join', { roomCode: room, user: { uid, name: uid } });
      await pending;
      strangers.push(s);
    }
    const fourth = await api.connect();
    const refused = once(fourth, 'join-refused');
    const pendingToo = collect(fourth, 'access-pending');
    fourth.emit('request-join', { roomCode: room, user: { uid: 'u4', name: 'u4' } });
    expect(await refused).toEqual({ roomCode: room, reason: 'busy' });
    await settle(fourth);
    expect(pendingToo).toEqual([]);
    expect(knocks.map((k) => k.name)).toEqual(['u1', 'u2', 'u3']); // the 4th never reached the Commander

    // An answer frees a place.
    alpha.emit('resolve-access', { targetId: knocks[0].targetId, roomCode: room, approved: false });
    await sleep(100);
    const pending = once(fourth, 'access-pending');
    fourth.emit('request-join', { roomCode: room, user: { uid: 'u4', name: 'u4' } });
    await pending;
  });
});

describe('join attempts are limited by person and by address (F-06)', () => {
  const byPerson = e2eServer({ env: { LOCUS_JOIN_ATTEMPTS_PER_MIN: '4' } });
  const byAddress = e2eServer({ env: { LOCUS_JOIN_ATTEMPTS_PER_MIN_PER_ADDRESS: '5' } });

  const knock = (socket, room, uid) => withinAMoment(new Promise((resolve) => {
    socket.once('access-pending', () => resolve('pending'));
    socket.once('join-refused', (p) => resolve(p));
    socket.emit('request-join', { roomCode: room, user: { uid, name: uid } });
  }), 1500);

  it('one account hammering the join is refused with the generic sign-in reason; others are unaffected', async () => {
    const room = byPerson.newRoom();
    const alpha = await byPerson.connect();
    await byPerson.createSquad(alpha, room, 'uA'); // one attempt of uA's
    const hammer = await byPerson.connect();
    const answers = [];
    for (let i = 0; i < 6; i += 1) answers.push(await knock(hammer, room, 'uH'));
    expect(answers.slice(0, 4)).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(answers[4]).toEqual({ roomCode: room, reason: 'identity', detail: 'unproven' });
    expect(answers[5]).toEqual(answers[4]);
    expect(await knock(await byPerson.connect(), room, 'uOther')).toBe('pending');
  });

  it('one address asking too often is refused with the very same answer, so nobody can tell which limit it was', async () => {
    const room = byAddress.newRoom();
    const alpha = await byAddress.connect();
    await byAddress.createSquad(alpha, room, 'uA'); // 1
    const answers = [];
    for (const uid of ['s1', 's2', 's3', 's4', 's5', 's6']) answers.push(await knock(await byAddress.connect(), room, uid));
    expect(answers.slice(0, 4)).toEqual(['pending', 'pending', 'pending', 'pending']); // 2-5
    expect(answers[4]).toEqual({ roomCode: room, reason: 'identity', detail: 'unproven' });
    expect(answers[5]).toEqual(answers[4]);
  });
});

describe('the number of live Groups is capped (F-06)', () => {
  const api = e2eServer({ env: { LOCUS_MAX_ACTIVE_SQUADS: '2' } });

  it('refuses a new Group over the ceiling, but still lets people join the existing ones', async () => {
    const [r1, r2, r3] = [api.newRoom(), api.newRoom(), api.newRoom()];
    const [a, b, c] = [await api.connect(), await api.connect(), await api.connect()];
    await api.createSquad(a, r1, 'uA');
    await api.createSquad(b, r2, 'uB');
    const refused = once(c, 'join-refused');
    c.emit('request-join', { roomCode: r3, intent: 'create', user: { uid: 'uC', name: 'C' } });
    expect(await refused).toEqual({ roomCode: r3, reason: 'busy' });

    const joiner = await api.connect();
    const pending = once(joiner, 'access-pending');
    joiner.emit('request-join', { roomCode: r1, intent: 'join', user: { uid: 'uJ', name: 'J' } });
    await pending;
  });
});

// ---------------------------------------------------------------------------------------------
describe('a connection that never joins a Group (F-07)', () => {
  const api = e2eServer({ env: { LOCUS_PRE_JOIN_TIMEOUT_MS: '400' } });

  it('is dropped, as a network drop rather than a kick, so the app reconnects by itself', async () => {
    const idle = api.connectWith({ reconnection: true, reconnectionDelay: 50, reconnectionDelayMax: 100 });
    const reasons = [];
    let connects = 0;
    idle.on('connect', () => { connects += 1; });
    idle.on('disconnect', (reason) => reasons.push(reason));
    await waitFor(() => connects >= 2, { timeout: 4000 });
    expect(reasons[0]).toBe('transport close'); // not 'io server disconnect', after which a client never retries
    expect(api.serverOutput()).toContain('did not join a Group within 400 ms');
  });

  it('leaves a member alone: joined before the time, still connected long after it', async () => {
    const room = api.newRoom();
    const alpha = await api.connect();
    await api.createSquad(alpha, room, 'uA');
    await sleep(1200);
    expect(alpha.connected).toBe(true);
    await settle(alpha);
  });

  it('lets a phone that dropped and came back join normally', async () => {
    const room = api.newRoom();
    const first = await api.connect();
    await api.createSquad(first, room, 'uA');
    first.disconnect();
    const back = await api.connect();
    expect(await api.requestJoin(back, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await sleep(900);
    expect(back.connected).toBe(true);
  });

  it('leaves no timer behind for connections that ended early', async () => {
    const before = (api.serverOutput().match(/did not join a Group/g) ?? []).length;
    for (let i = 0; i < 6; i += 1) {
      const s = await api.connect();
      s.disconnect();
    }
    await sleep(1000);
    expect((api.serverOutput().match(/did not join a Group/g) ?? []).length).toBe(before);
    expect(api.serverIsAlive()).toBe(true);
  });
});

describe('connections from one address (F-07)', () => {
  const api = e2eServer({ env: { LOCUS_MAX_SOCKETS_PER_IP: '2', LOCUS_PRE_JOIN_TIMEOUT_MS: '0' } });
  const opens = (socket) => new Promise((resolve) => {
    socket.once('connect', () => resolve('open'));
    socket.once('connect_error', (err) => resolve(err.message));
  });
  const from = (address) => api.connectWith({ extraHeaders: { 'x-forwarded-for': `203.0.113.250, ${address}` } });

  it('refuses a connection over the cap and counts the caller, not the proxy in front of them', async () => {
    expect(await opens(from('198.51.100.1'))).toBe('open');
    expect(await opens(from('198.51.100.1'))).toBe('open');
    expect(await opens(from('198.51.100.1'))).toBe('busy');
    // Another caller behind the same proxy is not affected.
    expect(await opens(from('198.51.100.2'))).toBe('open');
  });

  it('counts closed connections out again', async () => {
    const [a, b] = [from('198.51.100.9'), from('198.51.100.9')];
    expect(await Promise.all([opens(a), opens(b)])).toEqual(['open', 'open']);
    a.disconnect();
    await sleep(200);
    expect(await opens(from('198.51.100.9'))).toBe('open');
  });
});

// ---------------------------------------------------------------------------------------------
describe('what is relayed to the Group is only known, checked fields (F-14)', () => {
  const api = e2eServer();
  const route = { distance: 'CUSTOM', eta: 'TACTICAL', path: [{ lat: 12.8, lng: 80.0 }, { lat: 12.81, lng: 80.01 }] };

  it('a custom route arrives as key + distance + eta + points only, and a 90 KB blob is not carried along', async () => {
    const { room, alpha, bravo } = await api.squadOfThree();
    const routes = collect(alpha, 'new-custom-route');
    bravo.emit('publish-custom-route', {
      roomCode: room, key: 'Tech Park_Java Green', blob: 'x'.repeat(90_000), data: { ...route, extra: { deep: [1, 2] }, path: route.path.map((p) => ({ ...p, alt: 3 })) },
    });
    await waitFor(() => routes.length === 1);
    expect(routes[0]).toEqual({ roomCode: room, key: 'Tech Park_Java Green', data: route });
  });

  it('a route with too many points, or an impossible one, is not relayed at all', async () => {
    const { room, alpha, bravo } = await api.squadOfThree();
    const routes = collect(alpha, 'new-custom-route');
    const tooMany = Array.from({ length: 2001 }, (_, i) => ({ lat: 12 + i / 1e5, lng: 80 }));
    bravo.emit('publish-custom-route', { roomCode: room, key: 'long', data: { ...route, path: tooMany } });
    bravo.emit('publish-custom-route', { roomCode: room, key: 'off-globe', data: { ...route, path: [{ lat: 95, lng: 0 }, { lat: 1, lng: 1 }] } });
    bravo.emit('publish-custom-route', { roomCode: room, key: 'good', data: route });
    await waitFor(() => routes.length >= 1);
    await settle(bravo);
    await settle(alpha);
    expect(routes.map((r) => r.key)).toEqual(['good']);
  });

  it('a geofence alert names the sender as the server knows them and drops the rest', async () => {
    const { room, alpha, bravo } = await api.squadOfThree();
    const alerts = collect(alpha, 'geofence-alert');
    bravo.emit('geofence-alert', { roomCode: room, type: 'ENTER', zoneName: 'Library', userName: 'Dean', lat: 12.8, lng: 80.0, blob: 'x'.repeat(90_000), role: 'ADMIN' });
    await waitFor(() => alerts.length === 1);
    expect(alerts[0]).toEqual({ roomCode: room, type: 'ENTER', zoneName: 'Library', userName: 'uB', lat: 12.8, lng: 80.0 });
  });

  it('a zone arrives with its known fields only', async () => {
    const { room, alpha, bravo } = await api.squadOfThree();
    const zones = collect(alpha, 'new-zone');
    bravo.emit('publish-zone', { roomCode: room, zone: { name: 'Gate', lat: 12.8, lng: 80.0, radius: 50, blob: 'x'.repeat(90_000), script: '<img onerror=1>' } });
    bravo.emit('publish-zone', { roomCode: room, zone: { name: 'Bad', lat: 500, lng: 0 } });
    await waitFor(() => zones.length >= 1);
    await settle(bravo);
    await settle(alpha);
    expect(zones).toEqual([{ name: 'Gate', lat: 12.8, lng: 80.0, radius: 50 }]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('people who are not members still hear and relay nothing (regression)', () => {
  const api = e2eServer();

  it('a connection that never joined cannot raise an SOS, push a route, or hear the Group', async () => {
    const { room, alpha, bravo, charlie } = await api.squadOfThree();
    const outsider = await api.connect();
    const heard = [collect(outsider, 'users-update'), collect(outsider, 'new-custom-route'), collect(outsider, 'sos-received'), collect(outsider, 'new-waypoint')];
    const alerts = collect(outsider, 'alert-result');
    const routesAtAlpha = collect(alpha, 'new-custom-route');
    outsider.emit('sos-broadcast', { roomCode: room, senderName: 'Dean', lat: 12.8, lng: 80.0 });
    outsider.emit('publish-custom-route', { roomCode: room, key: 'x', data: { path: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] } });
    bravo.emit('update-location', { roomCode: room, lat: 12.82, lng: 80.04, name: 'uB', speed: 0, battery: 50, heading: 0, status: 'ACTIVE' });
    charlie.emit('sos-broadcast', { roomCode: room, lat: 12.82, lng: 80.04, clientId: 'c1' });
    await waitFor(() => alpha.sos.length === 1);
    await settle(outsider);
    await settle(alpha);
    expect(alerts[0]).toMatchObject({ type: 'sos', allowed: false, reasonCode: 'NOT_IN_GROUP' });
    expect(alpha.sos.map((s) => s.senderName)).toEqual(['uC']);
    expect(routesAtAlpha).toEqual([]);
    expect(heard.map((h) => h.length)).toEqual([0, 0, 0, 0]);
    expect(outsider.sos).toEqual([]);
  });

  it('a stranger holding the code but still waiting hears nothing of the Group', async () => {
    const { room, bravo, charlie } = await api.squadOfThree();
    const stranger = await api.connect();
    const pending = once(stranger, 'access-pending');
    stranger.emit('request-join', { roomCode: room, user: { uid: 'uS', name: 'S' } });
    await pending;
    const heard = [collect(stranger, 'users-update'), collect(stranger, 'sos-received'), collect(stranger, 'new-custom-route')];
    bravo.emit('update-location', { roomCode: room, lat: 12.82, lng: 80.04, name: 'uB', speed: 0, battery: 50, heading: 0, status: 'ACTIVE' });
    charlie.emit('sos-broadcast', { roomCode: room, lat: 12.82, lng: 80.04, clientId: 'c1' });
    bravo.emit('publish-custom-route', { roomCode: room, key: 'r', data: { path: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] } });
    await settle(bravo);
    await settle(stranger);
    expect(heard.map((h) => h.length)).toEqual([0, 0, 0]);
  });

  it('a member who was kicked hears and relays nothing afterwards', async () => {
    const { room, alpha, bravo, charlie } = await api.squadOfThree();
    const exiled = once(bravo, 'exiled');
    expect(await ask(alpha, 'kick-member', { roomCode: room, targetId: bravo.id })).toMatchObject({ ok: true });
    await exiled;
    const heard = [collect(bravo, 'users-update'), collect(bravo, 'new-custom-route')];
    const routesAtAlpha = collect(alpha, 'new-custom-route');
    charlie.emit('sos-broadcast', { roomCode: room, lat: 12.82, lng: 80.04, clientId: 'c1' });
    await waitFor(() => alpha.sos.length === 1);
    charlie.emit('update-location', { roomCode: room, lat: 12.9, lng: 80.1, name: 'uC', speed: 0, battery: 50, heading: 0, status: 'ACTIVE' });
    bravo.emit('publish-custom-route', { roomCode: room, key: 'x', data: { path: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] } });
    bravo.emit('sos-broadcast', { roomCode: room, lat: 12.8, lng: 80.0, clientId: 'b1' });
    await settle(bravo);
    await settle(alpha);
    expect(bravo.sos).toEqual([]);
    expect(heard.map((h) => h.length)).toEqual([0, 0]);
    expect(routesAtAlpha).toEqual([]);
    expect(alpha.sos).toHaveLength(1); // only Charlie's
  });
});

// ---------------------------------------------------------------------------------------------
describe('web hardening (F-18)', () => {
  const api = e2eServer();

  const request = (method, path, { origin, body, contentType = 'application/json' } = {}) => new Promise((resolve, reject) => {
    const req = http.request(`${api.url()}${path}`, { method, headers: { ...(origin ? { origin } : {}), ...(body ? { 'content-type': contentType } : {}) } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });

  it('sets the standard protective headers', async () => {
    const { headers } = await request('GET', '/nothing-here');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
    expect(headers['strict-transport-security']).toBeDefined();
  });

  it('allows the Capacitor app origins to read answers and no other web page', async () => {
    for (const origin of ['https://localhost', 'capacitor://localhost', 'http://localhost']) {
      expect((await request('GET', '/nothing-here', { origin })).headers['access-control-allow-origin'], origin).toBe(origin);
    }
    for (const origin of ['https://evil.example', 'https://localhost.evil.example', 'http://localhost:8080']) {
      expect((await request('GET', '/nothing-here', { origin })).headers['access-control-allow-origin'], origin).toBeUndefined();
    }
    // A request with no Origin (the native background service, a server) is not a browser's and is untouched.
    expect((await request('GET', '/nothing-here')).status).toBe(404);
  });

  it('answers a broken or oversized body generically, with no stack trace or echo of what was sent', async () => {
    const broken = await request('POST', '/api/nothing', { body: '{"token": "SECRET-VALUE", oops' });
    expect(broken.status).toBe(400);
    expect(JSON.parse(broken.text)).toEqual({ error: 'Bad request' });
    expect(broken.text).not.toMatch(/SECRET-VALUE|at .*\.js|node_modules/);
    const huge = await request('POST', '/api/nothing', { body: JSON.stringify({ pad: 'x'.repeat(200_000) }) });
    expect(huge.status).toBe(413);
    expect(JSON.parse(huge.text)).toEqual({ error: 'Too large' });
    expect(api.serverOutput()).not.toContain('SECRET-VALUE');
  });

  it('warns at startup that NODE_ENV is not production', () => {
    expect(api.serverOutput()).toContain('[SETUP] NODE_ENV is not "production"');
  });
});

describe('web hardening on a production-configured server (F-18)', () => {
  const api = e2eServer({ env: { NODE_ENV: 'production', LOCUS_ALLOWED_ORIGINS: 'https://app.example' } });

  it('does not warn, and takes its allowed origins from the environment', async () => {
    expect(api.serverOutput()).not.toContain('[SETUP] NODE_ENV');
    const answer = await new Promise((resolve) => {
      http.get(`${api.url()}/x`, { headers: { origin: 'https://app.example' } }, (res) => { res.resume(); resolve(res.headers); });
    });
    expect(answer['access-control-allow-origin']).toBe('https://app.example');
  });
});
