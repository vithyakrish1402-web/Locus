import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { e2eServer, sleep, waitFor, settle, once } from './helpers/e2eServer.js';

// Leave requests end to end (backend/leaveRequests.js and server.js): the real server, real Socket.IO
// clients. Groups whose code starts "NB" are made as if through Nearby Join
// (LOCUS_TEST_LEAVE_APPROVAL_PREFIX). A leave "minute" is 40 ms, so the 15-minute auto-approval is
// 600 ms. The offline Leave carries a sign-in token: the server runs the Firebase library in its
// emulator mode against a stub, as serverHardening.e2e.test.js does, so those tokens are really checked.

const PROJECT = 'locus-5c6a8';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);
const tokenFor = (uid) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: nowSec() - 10, user_id: uid, sub: uid,
    iat: nowSec() - 10, exp: nowSec() + 3600, firebase: { identities: {}, sign_in_provider: 'password' },
  })}.`;

const LEAVE_MINUTE = 40;
const AUTO_MS = 15 * LEAVE_MINUTE;
let stub;
const onEnv = { LOCUS_LEAVE_APPROVAL_ENABLED: 'true', LOCUS_TEST_LEAVE_APPROVAL_PREFIX: 'NB', LOCUS_LEAVE_MINUTE_MS: String(LEAVE_MINUTE), LOCUS_LEAVE_SWEEP_MS: '20' };
// As shipped: the server switch off (the test prefix still marks NB Groups, which must change nothing).
const offEnv = { LOCUS_TEST_LEAVE_APPROVAL_PREFIX: 'NB' };
beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let localId = 'x';
      try { localId = JSON.parse(body).localId?.[0] ?? 'x'; } catch { /* any body will do */ }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ users: [{ localId, disabled: false, validSince: '0' }] }));
    });
  });
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  for (const env of [onEnv, offEnv]) Object.assign(env, { FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${stub.address().port}`, LOCUS_ALLOW_AUTH_EMULATOR: 'true' });
});
afterAll(() => stub?.close());

const on = e2eServer({ env: onEnv });
const off = e2eServer({ env: offEnv });

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const collect = (socket, event) => {
  const seen = [];
  socket.on(event, (p) => seen.push(p ?? {}));
  return seen;
};
const watchRoster = (...sockets) => sockets.forEach((s) => {
  s.roster = {};
  s.on('users-update', (list) => { s.roster = list; });
});
const listed = (socket, uid) => Object.values(socket.roster ?? {}).find((e) => e.uid === uid);
const withinAMoment = (promise, ms = 250) => Promise.race([promise, sleep(ms).then(() => 'nothing')]);

// A Group of four: Alpha (Commander), Bravo, Charlie, Delta. `nearby`: an NB Group (needs approval
// to leave where the switch is on). Each test has its own accounts.
let seq = 0;
const group = async (api, { nearby = true } = {}) => {
  const n = ++seq;
  const room = `${nearby ? 'NB' : 'PL'}${n}`;
  const uid = { a: `a${n}`, b: `b${n}`, c: `c${n}`, d: `d${n}` };
  const [alpha, bravo, charlie, delta] = [await api.connect(), await api.connect(), await api.connect(), await api.connect()];
  const settings = once(alpha, 'group-settings');
  await api.createSquad(alpha, room, uid.a);
  const alphaSettings = await settings;
  await api.admit(alpha, bravo, room, uid.b);
  await api.admit(alpha, charlie, room, uid.c);
  await api.admit(alpha, delta, room, uid.d);
  watchRoster(alpha, bravo, charlie, delta);
  const requests = { alpha: collect(alpha, 'leave-request'), bravo: collect(bravo, 'leave-request'), charlie: collect(charlie, 'leave-request'), delta: collect(delta, 'leave-request') };
  await Promise.all([alpha, bravo, charlie, delta].map(settle));
  return { room, uid, alpha, bravo, charlie, delta, requests, alphaSettings };
};
const makeModerator = async (alpha, room, target) =>
  expect(await ask(alpha, 'set-moderator', { roomCode: room, targetId: target.id, moderator: true })).toEqual({ ok: true });

describe('with the server switch off (as shipped)', () => {
  it('a Nearby Group leaves exactly as today: no request, the Leave is immediate', async () => {
    const { room, uid, alpha, bravo, alphaSettings } = await group(off);
    expect(alphaSettings.leaveApproval).toBeUndefined();
    expect(await ask(bravo, 'request-leave', { roomCode: room })).toEqual({ ok: false, reason: 'not-required' });
    bravo.emit('leave-squad');
    await waitFor(() => listed(alpha, uid.b) === undefined);
    // Gone for good: back with the code means asking again.
    const again = await off.connect();
    expect((await off.requestJoin(again, room, uid.b)).outcome).toBe('pending');
  });
});

describe('with the server switch on, a Group not made through Nearby', () => {
  it('leaves exactly as today', async () => {
    const { room, uid, alpha, bravo, alphaSettings } = await group(on, { nearby: false });
    expect(alphaSettings.leaveApproval).toBeUndefined();
    expect(await ask(bravo, 'request-leave', { roomCode: room })).toEqual({ ok: false, reason: 'not-required' });
    expect(await ask(alpha, 'resolve-leave', { roomCode: room, uid: uid.b, approved: true })).toEqual({ ok: false, reason: 'not-required' });
    bravo.emit('leave-squad');
    await waitFor(() => listed(alpha, uid.b) === undefined);
    expect(Object.values(alpha.roster).every((e) => e.leaveRequestedUntil === undefined)).toBe(true);
  });
});

describe('in a Group made through Nearby, with the switch on', () => {
  it('says so in its settings', async () => {
    const { alphaSettings } = await group(on);
    expect(alphaSettings.leaveApproval).toBe(true);
  });

  it("a member's request goes to the admin and moderators, not to members, and shows on the list", async () => {
    const { room, uid, alpha, bravo, charlie, delta, requests } = await group(on);
    await makeModerator(alpha, room, charlie);
    const before = Date.now();
    const reply = await ask(bravo, 'request-leave', { roomCode: room });
    expect(reply.ok).toBe(true);
    expect(reply.deadline).toBeGreaterThanOrEqual(before + AUTO_MS);
    await waitFor(() => requests.alpha.length && requests.charlie.length);
    expect(requests.alpha[0]).toMatchObject({ roomCode: room, uid: uid.b, deadline: reply.deadline, fromModerator: false, fromCommander: false });
    await settle(delta);
    expect(requests.delta).toEqual([]);
    await waitFor(() => listed(alpha, uid.b)?.leaveRequestedUntil === reply.deadline);
    // Asking again: the same request, the same deadline, nobody told twice.
    const again = await ask(bravo, 'request-leave', { roomCode: room });
    expect(again.deadline).toBe(reply.deadline);
    await settle(alpha);
    expect(requests.alpha).toHaveLength(1);
    expect((await ask(alpha, 'get-leave-requests', { roomCode: room })).requests.map((r) => r.uid)).toEqual([uid.b]);
    expect(await ask(delta, 'get-leave-requests', { roomCode: room })).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('approved: they are removed, their sharing stops, and coming back means asking again', async () => {
    const { room, uid, alpha, bravo, charlie } = await group(on);
    await makeModerator(alpha, room, charlie);
    const withdrawn = collect(charlie, 'leave-request-withdrawn');
    await ask(bravo, 'request-leave', { roomCode: room });
    const approved = once(bravo, 'leave-approved');
    expect(await ask(alpha, 'resolve-leave', { roomCode: room, uid: uid.b, approved: true })).toEqual({ ok: true });
    expect(await approved).toEqual({ roomCode: room, auto: false });
    await waitFor(() => listed(alpha, uid.b) === undefined);
    await waitFor(() => withdrawn.some((w) => w.uid === uid.b && w.reason === 'approved'));
    // No longer in the Group: a position from them is not taken.
    bravo.emit('update-location', { roomCode: room, lat: 12.82, lng: 80.04, status: 'ACTIVE' });
    await settle(bravo);
    await sleep(30);
    expect(listed(alpha, uid.b)).toBeUndefined();
    const log = (await ask(alpha, 'get-activity-log', { roomCode: room })).log;
    expect(log.find((e) => e.uid === uid.b && e.kind === 'left-group')).toMatchObject({ byName: uid.a });
    expect((await on.requestJoin(await on.connect(), room, uid.b)).outcome).toBe('pending');
  });

  it('a moderator can approve a member', async () => {
    const { room, uid, alpha, bravo, charlie } = await group(on);
    await makeModerator(alpha, room, charlie);
    await ask(bravo, 'request-leave', { roomCode: room });
    expect(await ask(charlie, 'resolve-leave', { roomCode: room, uid: uid.b, approved: true })).toEqual({ ok: true });
    await waitFor(() => listed(alpha, uid.b) === undefined);
  });

  it('rejected: they stay, sharing, and are told', async () => {
    const { room, uid, alpha, bravo, charlie } = await group(on);
    await makeModerator(alpha, room, charlie);
    await ask(bravo, 'request-leave', { roomCode: room });
    const rejected = once(bravo, 'leave-rejected');
    expect(await ask(charlie, 'resolve-leave', { roomCode: room, uid: uid.b, approved: false })).toEqual({ ok: true });
    expect(await rejected).toEqual({ roomCode: room, byName: uid.c });
    bravo.emit('update-location', { roomCode: room, lat: 12.82, lng: 80.04, status: 'ACTIVE' });
    await waitFor(() => listed(alpha, uid.b)?.hasFix);
    expect(listed(alpha, uid.b).leaveRequestedUntil).toBeUndefined();
    expect(await ask(alpha, 'resolve-leave', { roomCode: room, uid: uid.b, approved: true })).toEqual({ ok: false, reason: 'no-request' });
  });

  it('a member cannot answer, and nobody answers their own', async () => {
    const { room, uid, alpha, bravo, delta } = await group(on);
    await ask(bravo, 'request-leave', { roomCode: room });
    expect(await ask(delta, 'resolve-leave', { roomCode: room, uid: uid.b, approved: true })).toEqual({ ok: false, reason: 'not-allowed' });
    expect(await ask(bravo, 'resolve-leave', { roomCode: room, uid: uid.b, approved: true })).toEqual({ ok: false, reason: 'own-request' });
    expect(await ask(alpha, 'resolve-leave', { roomCode: room, uid: uid.b, approved: 'yes' })).toEqual({ ok: false, reason: 'bad-answer' });
    expect(listed(alpha, uid.b)).toBeDefined();
  });

  it('the member can take their request back before it is answered, and goes on as a member', async () => {
    const { room, uid, alpha, bravo } = await group(on);
    const withdrawn = collect(alpha, 'leave-request-withdrawn');
    await ask(bravo, 'request-leave', { roomCode: room });
    await waitFor(() => listed(alpha, uid.b)?.leaveRequestedUntil);
    const cancelled = once(bravo, 'leave-request-cancelled');
    expect(await ask(bravo, 'cancel-leave', { roomCode: room })).toEqual({ ok: true });
    expect(await cancelled).toEqual({ roomCode: room, reason: 'cancelled' });
    await waitFor(() => withdrawn.some((w) => w.uid === uid.b && w.reason === 'cancelled'));
    await waitFor(() => listed(alpha, uid.b) && listed(alpha, uid.b).leaveRequestedUntil === undefined);
    expect((await ask(alpha, 'get-leave-requests', { roomCode: room })).requests).toEqual([]);
    // Sharing as normal, and nothing left for the clock to approve.
    bravo.emit('update-location', { roomCode: room, lat: 12.82, lng: 80.04, status: 'ACTIVE' });
    await waitFor(() => listed(alpha, uid.b)?.hasFix);
    await sleep(AUTO_MS + 100);
    expect(listed(alpha, uid.b)).toBeDefined();
    expect(await ask(bravo, 'cancel-leave', { roomCode: room })).toEqual({ ok: false, reason: 'no-request' });
  });

  it("nobody can take back someone else's request, and one cancelled leaves the others' deadlines alone", async () => {
    const { room, uid, alpha, bravo, charlie, delta } = await group(on);
    const b = await ask(bravo, 'request-leave', { roomCode: room });
    const c = await ask(charlie, 'request-leave', { roomCode: room });
    // Delta (and the admin) naming Bravo's uid cancel nothing: a request is found by who is asking.
    expect(await ask(delta, 'cancel-leave', { roomCode: room, uid: uid.b })).toEqual({ ok: false, reason: 'no-request' });
    expect(await ask(alpha, 'cancel-leave', { roomCode: room, uid: uid.b })).toEqual({ ok: false, reason: 'no-request' });
    expect(await ask(bravo, 'cancel-leave', { roomCode: room })).toEqual({ ok: true });
    const open = (await ask(alpha, 'get-leave-requests', { roomCode: room })).requests;
    expect(open.map((r) => [r.uid, r.deadline])).toEqual([[uid.c, c.deadline]]);
    expect(b.deadline).toBeLessThanOrEqual(c.deadline);
  });

  it('cannot be taken back once approved', async () => {
    const { room, uid, alpha, bravo } = await group(on);
    await ask(bravo, 'request-leave', { roomCode: room });
    const approved = once(bravo, 'leave-approved');
    await ask(alpha, 'resolve-leave', { roomCode: room, uid: uid.b, approved: true });
    await approved;
    expect(await ask(bravo, 'cancel-leave', { roomCode: room })).toEqual({ ok: false, reason: 'not-in-squad' });
    await waitFor(() => listed(alpha, uid.b) === undefined);
  });

  it('cancel-leave in a Group that does not need approval answers not-required', async () => {
    const { room, bravo } = await group(on, { nearby: false });
    expect(await ask(bravo, 'cancel-leave', { roomCode: room })).toEqual({ ok: false, reason: 'not-required' });
  });

  it('unanswered, it is approved on its own when its 15 minutes are up', async () => {
    const { room, uid, alpha, bravo } = await group(on);
    const reply = await ask(bravo, 'request-leave', { roomCode: room });
    const approved = await once(bravo, 'leave-approved');
    expect(Date.now()).toBeGreaterThanOrEqual(reply.deadline);
    expect(approved).toEqual({ roomCode: room, auto: true });
    await waitFor(() => listed(alpha, uid.b) === undefined);
    const log = (await ask(alpha, 'get-activity-log', { roomCode: room })).log;
    expect(log.find((e) => e.uid === uid.b && e.kind === 'left-group')).toMatchObject({ byName: 'Approved automatically' });
  });

  it("a moderator's request goes to the admin only, and another moderator cannot answer it", async () => {
    const { room, uid, alpha, bravo, charlie, requests } = await group(on);
    await makeModerator(alpha, room, bravo);
    await makeModerator(alpha, room, charlie);
    await ask(bravo, 'request-leave', { roomCode: room });
    await waitFor(() => requests.alpha.length);
    expect(requests.alpha[0]).toMatchObject({ uid: uid.b, fromModerator: true });
    await settle(charlie);
    expect(requests.charlie).toEqual([]);
    expect(await ask(charlie, 'resolve-leave', { roomCode: room, uid: uid.b, approved: true })).toEqual({ ok: false, reason: 'admin-only' });
    expect(await ask(alpha, 'resolve-leave', { roomCode: room, uid: uid.b, approved: false })).toEqual({ ok: true });
  });

  it('the admin cannot ask, and leaves directly, passing the Group on as today', async () => {
    const { room, uid, alpha, bravo, charlie } = await group(on);
    expect(await ask(alpha, 'request-leave', { roomCode: room })).toEqual({ ok: false, reason: 'admin' });
    const promoted = once(bravo, 'promoted-to-owner');
    alpha.emit('leave-squad');
    expect(await promoted).toEqual({ roomCode: room });
    await waitFor(() => listed(charlie, uid.a) === undefined);
    // The Group is Bravo's now: Alpha coming back is a stranger asking.
    expect((await on.requestJoin(await on.connect(), room, uid.a)).outcome).toBe('pending');
  });

  it("an older app's Leave, or signing out, files the request: sharing stops, still a member", async () => {
    const { room, uid, alpha, bravo, requests } = await group(on);
    bravo.emit('leave-squad');
    await waitFor(() => requests.alpha.some((r) => r.uid === uid.b));
    await waitFor(() => !Object.keys(alpha.roster).includes(bravo.id));
    // Still a member: back without anyone approving, the request still waiting with its deadline.
    const deadline = requests.alpha[0].deadline;
    const again = await on.connect();
    const pending = once(again, 'leave-request-pending');
    expect((await on.returnToSquad(again, room, uid.b)).outcome).toBe('granted');
    expect(await pending).toMatchObject({ roomCode: room, deadline });
  });

  it('a waiting request survives signing out, and a rejoin keeps the same deadline', async () => {
    const { room, uid, alpha, bravo } = await group(on);
    const reply = await ask(bravo, 'request-leave', { roomCode: room });
    bravo.emit('leave-squad'); // signs out
    await waitFor(() => !Object.keys(alpha.roster).includes(bravo.id));
    const again = await on.connect();
    const pending = once(again, 'leave-request-pending');
    expect((await on.returnToSquad(again, room, uid.b)).outcome).toBe('granted');
    expect(await pending).toMatchObject({ deadline: reply.deadline });
    expect((await ask(again, 'request-leave', { roomCode: room })).deadline).toBe(reply.deadline);
    await waitFor(() => listed(alpha, uid.b)?.leaveRequestedUntil === reply.deadline);
  });

  it('the offline Leave is a request too, never a way round it', async () => {
    const { room, uid, alpha, charlie, requests } = await group(on);
    charlie.disconnect();
    await sleep(30);
    const later = await on.connect();
    later.emit('leave-squad', { roomCode: room, idToken: tokenFor(uid.c) });
    await waitFor(() => requests.alpha.some((r) => r.uid === uid.c));
    // Still a member: back in without approval.
    expect((await on.returnToSquad(await on.connect(), room, uid.c)).outcome).toBe('granted');
    expect((await ask(alpha, 'get-leave-requests', { roomCode: room })).requests.map((r) => r.uid)).toEqual([uid.c]);
  });

  it('with nobody holding command, a connected member who is not leaving stands in and is handed it', async () => {
    const { room, uid, alpha, bravo, charlie } = await group(on);
    const promotedBravo = collect(bravo, 'promoted-to-owner');
    alpha.disconnect();
    await sleep(50);
    const promoted = once(charlie, 'promoted-to-owner');
    const handed = once(charlie, 'leave-request');
    await ask(bravo, 'request-leave', { roomCode: room });
    expect(await promoted).toEqual({ roomCode: room });
    expect(await handed).toMatchObject({ uid: uid.b });
    expect(promotedBravo).toEqual([]);
  });

  it('with nobody connected who can answer, it waits for whoever takes command', async () => {
    const { room, uid, alpha, bravo, charlie, delta } = await group(on);
    charlie.disconnect();
    delta.disconnect();
    alpha.disconnect();
    await sleep(50);
    const reply = await ask(bravo, 'request-leave', { roomCode: room });
    expect(reply.ok).toBe(true);
    // The Commander comes back: handed the request.
    const back = await on.connect();
    const handed = once(back, 'leave-request');
    expect((await on.returnToSquad(back, room, uid.a)).outcome).toBe('granted');
    expect(await handed).toMatchObject({ uid: uid.b, deadline: reply.deadline });
  });
});

describe('a stand-in', () => {
  // Alpha (Commander) drops off; Bravo comes back on a new connection and takes command (Case 4).
  const withStandIn = async () => {
    const g = await group(on);
    g.alpha.disconnect();
    g.bravo.disconnect();
    await sleep(50);
    g.standIn = await on.connect();
    g.standIn.requests = collect(g.standIn, 'leave-request');
    expect(await on.returnToSquad(g.standIn, g.room, g.uid.b)).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    return g;
  };

  it('can approve and refuse a member', async () => {
    const { room, uid, standIn, charlie, delta } = await withStandIn();
    await ask(charlie, 'request-leave', { roomCode: room });
    await ask(delta, 'request-leave', { roomCode: room });
    expect(await ask(standIn, 'resolve-leave', { roomCode: room, uid: uid.c, approved: true })).toEqual({ ok: true });
    expect(await ask(standIn, 'resolve-leave', { roomCode: room, uid: uid.d, approved: false })).toEqual({ ok: true });
  });

  it("cannot refuse the Commander's request (made offline while away), but can approve it", async () => {
    const { room, uid, standIn } = await withStandIn();
    const later = await on.connect();
    later.emit('leave-squad', { roomCode: room, idToken: tokenFor(uid.a) });
    await waitFor(() => standIn.requests.some((r) => r.uid === uid.a));
    expect(standIn.requests.find((r) => r.uid === uid.a)).toMatchObject({ fromCommander: true });
    expect(await ask(standIn, 'resolve-leave', { roomCode: room, uid: uid.a, approved: false })).toEqual({ ok: false, reason: 'cannot-refuse-commander' });
    expect(await ask(standIn, 'resolve-leave', { roomCode: room, uid: uid.a, approved: true })).toEqual({ ok: true });
    // The Commander has left: the Group is the stand-in's now, and Alpha is a stranger to it.
    expect((await on.requestJoin(await on.connect(), room, uid.a)).outcome).toBe('pending');
  });

  it("the Commander's waiting request ends when they come back and take command: they leave directly now", async () => {
    const { room, uid, standIn } = await withStandIn();
    const later = await on.connect();
    later.emit('leave-squad', { roomCode: room, idToken: tokenFor(uid.a) });
    await waitFor(() => standIn.requests.some((r) => r.uid === uid.a));
    const withdrawn = collect(standIn, 'leave-request-withdrawn');
    const back = await on.connect();
    const cancelled = once(back, 'leave-request-cancelled');
    expect(await on.returnToSquad(back, room, uid.a)).toMatchObject({ role: 'OWNER' });
    expect(await cancelled).toEqual({ roomCode: room, reason: 'took-command' });
    await waitFor(() => withdrawn.some((w) => w.uid === uid.a && w.reason === 'took-command'));
    expect(await ask(back, 'request-leave', { roomCode: room })).toEqual({ ok: false, reason: 'admin' });
  });

  it("leaves directly: the stand-in holds command, so it is the admin's Leave", async () => {
    const { room, standIn } = await withStandIn();
    expect(await ask(standIn, 'request-leave', { roomCode: room })).toEqual({ ok: false, reason: 'admin' });
  });
});

describe('everything else in a Nearby Group behaves as before', () => {
  it('kick is immediate, and takes a waiting request with it', async () => {
    const { room, uid, alpha, bravo } = await group(on);
    const withdrawn = collect(alpha, 'leave-request-withdrawn');
    await ask(bravo, 'request-leave', { roomCode: room });
    const exiled = once(bravo, 'exiled');
    expect(await ask(alpha, 'kick-member', { roomCode: room, targetId: bravo.id })).toEqual({ ok: true });
    expect(await exiled).toEqual({ reason: 'kicked' });
    await waitFor(() => withdrawn.some((w) => w.uid === uid.b && w.reason === 'removed'));
    expect((await ask(alpha, 'get-leave-requests', { roomCode: room })).requests).toEqual([]);
  });

  it('block is immediate and keeps them out', async () => {
    const { room, uid, alpha, charlie } = await group(on);
    const exiled = once(charlie, 'exiled');
    expect(await ask(alpha, 'block-user', { roomCode: room, targetId: charlie.id })).toEqual({ ok: true });
    expect(await exiled).toEqual({ reason: 'blocked' });
    expect((await on.requestJoin(await on.connect(), room, uid.c)).outcome).toBe('denied');
  });

  it('a vote-out is immediate, and takes a waiting request with it', async () => {
    const { room, uid, alpha, bravo, charlie, delta } = await group(on);
    const withdrawn = collect(alpha, 'leave-request-withdrawn');
    await ask(delta, 'request-leave', { roomCode: room });
    const exiled = once(delta, 'exiled');
    bravo.emit('vote-to-kick', { roomCode: room, targetId: delta.id });
    charlie.emit('vote-to-kick', { roomCode: room, targetId: delta.id });
    await exiled;
    await waitFor(() => listed(alpha, uid.d) === undefined);
    await waitFor(() => withdrawn.some((w) => w.uid === uid.d && w.reason === 'removed'));
  });

  it('the Commander reclaims the Group from a stand-in, who is told', async () => {
    const { room, uid, alpha, bravo } = await group(on);
    alpha.disconnect();
    bravo.disconnect();
    await sleep(50);
    const standIn = await on.connect();
    expect(await on.returnToSquad(standIn, room, uid.b)).toMatchObject({ role: 'OWNER' });
    const demoted = once(standIn, 'demoted-to-member');
    const back = await on.connect();
    expect(await on.returnToSquad(back, room, uid.a)).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    expect(await demoted).toEqual({ roomCode: room });
  });

  it("a member's disconnect is not a Leave and files no request", async () => {
    const { room, alpha, bravo, requests } = await group(on);
    bravo.disconnect();
    expect(await withinAMoment(waitFor(() => requests.alpha.length))).toBe('nothing');
    expect((await ask(alpha, 'get-leave-requests', { roomCode: room })).requests).toEqual([]);
  });

  it('copes with malformed leave events', async () => {
    const { bravo } = await group(on);
    for (const event of ['request-leave', 'cancel-leave', 'resolve-leave', 'get-leave-requests']) {
      for (const bad of [undefined, null, 7, 'x', { roomCode: 5 }, { roomCode: 'NOPE', uid: 'x', approved: true }]) bravo.emit(event, bad);
    }
    await settle(bravo);
    expect(on.serverIsAlive()).toBe(true);
  });
});
