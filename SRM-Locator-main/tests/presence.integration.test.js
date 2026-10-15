import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as connectIo } from 'socket.io-client';
import { sleep, waitFor } from './helpers/e2eServer.js';

/**
 * Presence by uid, end to end: the real backend/server.js running inside this test, real
 * Socket.IO clients, the real join and approval flow. The server's own function for a report
 * from a phone that is sharing without a socket (acceptBackgroundPosition) is called directly,
 * because the endpoint that will call it comes in a later change.
 *
 * Leases and sweeps are shortened from minutes to fractions of a second.
 */

// Set before the server loads: it reads its settings once, when it starts.
Object.assign(process.env, {
  PORT: '0',
  LOCUS_LEASE_MIN_SEC: '0.4',
  LOCUS_LEASE_MAX_SEC: '1',
  LOCUS_PRESENCE_CHECK_MS: '30',
  LOCUS_SWEEP_INTERVAL_MS: '100',
  LOCUS_ROOM_TTL_MS: '600',
  LOCUS_CLASS_CLOCK_ISO: '2026-01-04T10:00:00Z',
  LOCUS_FORCE_CLASS_HOURS: '',
});

let url;
let accept;
let stopServer;
const clients = [];
let roomSeq = 0;

beforeAll(async () => {
  const server = await import('../backend/server.js');
  accept = server.acceptBackgroundPosition;
  stopServer = server.stopServer;
  url = `http://localhost:${await server.listening}`;
});

afterEach(() => clients.splice(0).forEach((s) => s.disconnect()));
afterAll(() => stopServer());

const WHERE = { lat: 12.8222, lng: 80.0436 };
const newRoom = () => `PRES${++roomSeq}`;

const connect = async () => {
  const socket = connectIo(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  Object.assign(socket, { updates: [], lost: [], granted: [], exiled: [] });
  socket.on('users-update', (p) => socket.updates.push(p));
  socket.on('member-signal-lost', (p) => socket.lost.push(p));
  socket.on('exiled', () => socket.exiled.push(true));
  // What the app does while it is open (App.jsx's latency probe, every 2 s, shortened here): it
  // is what tells the server the squad is in use even when nobody has a fix.
  const keepAlive = setInterval(() => socket.connected && socket.emit('check-ping', Date.now()), 100);
  socket.on('disconnect', () => clearInterval(keepAlive));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  clients.push(socket);
  return socket;
};

const join = (socket, room, uid, name = uid, extra = {}) =>
  new Promise((resolve) => {
    socket.once('access-granted', (p) => resolve({ outcome: 'granted', ...p }));
    socket.once('access-pending', () => resolve({ outcome: 'pending' }));
    socket.once('access-denied', () => resolve({ outcome: 'denied' }));
    socket.once('squad-not-found', () => resolve({ outcome: 'not-found' }));
    socket.once('squad-code-taken', () => resolve({ outcome: 'taken' }));
    socket.emit('request-join', { roomCode: room, user: { uid, name }, ...extra });
  });

const admit = async (owner, socket, room, uid, name = uid) => {
  const request = new Promise((resolve) => owner.once('access-request', resolve));
  const granted = new Promise((resolve) => socket.once('access-granted', resolve));
  socket.emit('request-join', { roomCode: room, user: { uid, name } });
  const { targetId } = await request;
  owner.emit('resolve-access', { targetId, roomCode: room, approved: true });
  await granted;
};

const report = (socket, room, where = WHERE, name = 'x') => {
  socket.emit('update-location', { ...where, name, roomCode: room, heading: 0, battery: 90 });
};

const newest = (socket) => socket.updates[socket.updates.length - 1] ?? {};
const keysOf = (update) => Object.keys(update);
const entriesFor = (update, uid) => Object.entries(update).filter(([, v]) => v.uid === uid);

// Alpha (Commander, uA), Bravo (uB), Charlie (uC), all connected and located.
const group = async (people = ['uB', 'uC']) => {
  const room = newRoom();
  const alpha = await connect();
  expect(await join(alpha, room, 'uA', 'Alpha', { intent: 'create' })).toMatchObject({ outcome: 'granted', role: 'OWNER' });
  const members = {};
  for (const uid of people) {
    members[uid] = await connect();
    await admit(alpha, members[uid], room, uid, `N${uid}`);
    report(members[uid], room, WHERE, `N${uid}`);
  }
  report(alpha, room, WHERE, 'Alpha');
  await waitFor(() => keysOf(newest(alpha)).length === people.length + 1);
  return { room, alpha, ...members };
};

const lease = 0.4; // seconds: LOCUS_LEASE_MIN_SEC

describe('someone who has swiped the app away', () => {
  it('stays on everyone\'s map and list, with no signal-lost, for as long as the lease runs', async () => {
    const { room, alpha, uB: bravo } = await group();
    const posted = Date.now();
    expect(accept(room, 'uB', { lat: 12.9, lng: 80.1, battery: 55 })).toMatchObject({ ok: true });
    bravo.disconnect(); // the app is gone

    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB') && !keysOf(newest(alpha)).includes(bravo.id));
    expect(newest(alpha)['bg:uB']).toMatchObject({
      uid: 'uB', name: 'NuB', lat: 12.9, lng: 80.1, battery: 55, status: 'ACTIVE', hasFix: true, presence: true, roomCode: room,
    });
    await sleep(150);
    expect(alpha.lost).toEqual([]); // the connection dropped; the lease has not

    // Then the lease runs out: the Group is told, once, and they leave the map and the list.
    await waitFor(() => alpha.lost.length);
    expect(Date.now() - posted).toBeGreaterThanOrEqual(lease * 1000 - 50);
    expect(alpha.lost).toHaveLength(1);
    expect(alpha.lost[0]).toMatchObject({
      targetId: 'bg:uB', uid: 'uB', name: 'NuB',
      lastKnownLocation: { latitude: 12.9, longitude: 80.1, batteryLevel: 55 },
    });
    expect(alpha.lost[0].timeDelta).toBeGreaterThanOrEqual(lease - 0.1);
    await waitFor(() => !keysOf(newest(alpha)).includes('bg:uB'));
    await sleep(150);
    expect(alpha.lost).toHaveLength(1);
  });

  it('is kept as long as they keep reporting, and lost the lease after they stop', async () => {
    const { room, alpha, uB: bravo } = await group();
    bravo.disconnect();
    const until = Date.now() + 1200; // three leases
    while (Date.now() < until) {
      expect(accept(room, 'uB', WHERE).ok).toBe(true);
      await sleep(150);
    }
    expect(alpha.lost).toEqual([]);
    expect(keysOf(newest(alpha))).toContain('bg:uB');
    await waitFor(() => alpha.lost.length);
    expect(alpha.lost[0].uid).toBe('uB');
  });

  it('holds a longer lease when the phone says it will be quiet for longer, up to the maximum', async () => {
    const { room, alpha, uB: bravo } = await group();
    bravo.disconnect();
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 0.3 }); // 3 x 0.3 = 0.9 s
    await sleep(600); // beyond the minimum lease, inside this one
    expect(alpha.lost).toEqual([]);
    expect(keysOf(newest(alpha))).toContain('bg:uB');
    await waitFor(() => alpha.lost.length);

    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 1000 }); // capped at 1 s
    const capped = Date.now();
    alpha.lost.length = 0;
    await waitFor(() => alpha.lost.length, { timeout: 3000 });
    expect(Date.now() - capped).toBeLessThan(1500);
  });

  it('puts a report on the map straight away, without waiting for anything else to happen', async () => {
    const { room, alpha, uB: bravo } = await group();
    const bravoId = bravo.id;
    bravo.disconnect();
    await waitFor(() => !keysOf(newest(alpha)).includes(bravoId));
    await sleep(100);
    const before = alpha.updates.length;
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 0.3 });
    await waitFor(() => alpha.updates.length > before && keysOf(newest(alpha)).includes('bg:uB'), { timeout: 200 });
  });

  it('shows as paused, with the position they paused at', async () => {
    const { room, alpha, uB: bravo } = await group();
    bravo.disconnect();
    accept(room, 'uB', { ...WHERE, status: 'FROZEN', nextPostWithinSec: 0.3 });
    await waitFor(() => newest(alpha)['bg:uB']);
    expect(newest(alpha)['bg:uB']).toMatchObject({ status: 'FROZEN', lat: WHERE.lat });
  });

  it('is a swipe in two stages: the dying connection is still listed for a while, then they take over without a gap', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uB', { lat: 12.95, lng: 80.2 }); // the service starts, the old connection still looks alive
    await sleep(100);
    expect(entriesFor(newest(alpha), 'uB')).toHaveLength(1); // one person, one marker
    expect(keysOf(newest(alpha))).not.toContain('bg:uB');
    bravo.disconnect(); // the old connection is finally noticed as dead
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));
    expect(newest(alpha)['bg:uB']).toMatchObject({ lat: 12.95 });
    expect(entriesFor(newest(alpha), 'uB')).toHaveLength(1);
    await sleep(100);
    expect(alpha.lost).toEqual([]);
  });
});

describe('one person, one marker', () => {
  it('a person with a live connection is never listed a second time as sharing from the background', async () => {
    const { room, alpha, uB: bravo } = await group();
    for (let i = 0; i < 5; i++) {
      accept(room, 'uB', WHERE);
      report(bravo, room);
      await sleep(40);
    }
    for (const update of alpha.updates.slice(-8)) {
      expect(entriesFor(update, 'uB')).toHaveLength(1);
      expect(Object.keys(update)).not.toContain('bg:uB');
    }
  });

  it('when their app reconnects, the live connection takes over and the lease is dropped', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uB', WHERE);
    bravo.disconnect();
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));

    const back = await connect();
    expect(await join(back, room, 'uB', 'NuB')).toMatchObject({ outcome: 'granted', role: 'MEMBER' }); // no new approval
    report(back, room);
    const after = alpha.updates.length;
    await waitFor(() => keysOf(newest(alpha)).includes(back.id));
    // From the moment they are back, no roster is sent with both, or with the sharing entry.
    for (const update of alpha.updates.slice(after)) {
      if (keysOf(update).includes(back.id)) expect(keysOf(update)).not.toContain('bg:uB');
      expect(entriesFor(update, 'uB').length).toBeLessThanOrEqual(1);
    }

    // And their lease really is gone: when this connection drops it is the ordinary signal-lost.
    const backId = back.id; // a client forgets its id once it has disconnected
    back.disconnect();
    await waitFor(() => alpha.lost.length);
    expect(alpha.lost[0]).toMatchObject({ uid: 'uB', targetId: backId });
    expect(keysOf(newest(alpha))).not.toContain('bg:uB');
  });

  it('their lease running out raises nothing while they are connected', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uB', WHERE);
    await sleep(700); // well past the 0.4 s lease
    expect(alpha.lost).toEqual([]);
    expect(entriesFor(newest(alpha), 'uB')).toHaveLength(1);
    expect(keysOf(newest(alpha))).toContain(bravo.id);
  });

  it('the Commander coming back from the background takes over cleanly, and their lease is dropped', async () => {
    const { room, alpha, uB: bravo } = await group(['uB']);
    accept(room, 'uA', { ...WHERE, nextPostWithinSec: 1 }); // the longest lease there is
    alpha.disconnect();
    await waitFor(() => keysOf(newest(bravo)).includes('bg:uA'));

    const alpha2 = await connect();
    expect(await join(alpha2, room, 'uA', 'Alpha')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    report(alpha2, room, WHERE, 'Alpha');
    await waitFor(() => keysOf(newest(bravo)).includes(alpha2.id));
    expect(keysOf(newest(bravo))).not.toContain('bg:uA');

    // Their lease really is gone (it had most of a second left): dropping again is signal-lost at once.
    const alpha2Id = alpha2.id;
    alpha2.disconnect();
    await waitFor(() => bravo.lost.length, { timeout: 400 });
    expect(bravo.lost[0]).toMatchObject({ uid: 'uA', targetId: alpha2Id });
  });

  it('a member standing in while the Commander is away takes over from their own lease the same way', async () => {
    const { room, alpha, uB: bravo } = await group(['uB']);
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 1 });
    bravo.disconnect();
    alpha.disconnect();
    await sleep(100);

    const bravo2 = await connect();
    expect(await join(bravo2, room, 'uB', 'NuB')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    report(bravo2, room, WHERE, 'NuB'); // signal-lost is only ever raised for someone with a position on file
    const bravo2Id = bravo2.id;
    const watcher = await connect();
    expect(await join(watcher, room, 'uA', 'Alpha')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    bravo2.disconnect();
    await waitFor(() => watcher.lost.length, { timeout: 400 });
    expect(watcher.lost[0]).toMatchObject({ uid: 'uB', targetId: bravo2Id });
  });

  it('the returning member is rebound as before: one connection of theirs on the roster, no ghost of the old one', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uB', WHERE);
    // They come back on a new connection BEFORE the old one has been noticed as dead.
    const back = await connect();
    expect(await join(back, room, 'uB', 'NuB')).toMatchObject({ outcome: 'granted', role: 'MEMBER' });
    report(back, room);
    await waitFor(() => keysOf(newest(alpha)).includes(back.id));
    expect(keysOf(newest(alpha))).not.toContain(bravo.id);
    expect(entriesFor(newest(alpha), 'uB')).toHaveLength(1);
    await sleep(100);
    expect(alpha.lost).toEqual([]);
  });
});

describe('a Group held open by people sharing', () => {
  it('survives everyone\'s connection dropping, until the last lease ends', async () => {
    const { room, alpha, uB: bravo } = await group(['uB']);
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 1 }); // 1 s, longer than the 0.6 s room timeout
    alpha.disconnect();
    bravo.disconnect();
    await sleep(500); // several sweeps (every 100 ms) with an empty roster

    // Still a squad: a stranger asking to join waits for approval, and cannot found a new one.
    const stranger = await connect();
    expect(await join(stranger, room, 'uZ', 'Zed', { intent: 'join' })).toEqual({ outcome: 'pending' });
    const founder = await connect();
    expect(await join(founder, room, 'uY', 'Yan', { intent: 'create' })).toEqual({ outcome: 'taken' });
    const resumer = await connect();
    expect(await join(resumer, room, 'uX', 'Xan')).toEqual({ outcome: 'pending' }); // not "an abandoned room"

    // Past the room timeout since the last report, a running lease still holds it.
    await sleep(250);
    const late = await connect();
    expect(await join(late, room, 'uV', 'Vee', { intent: 'join' })).toEqual({ outcome: 'pending' });

    // Lease over, sweep done: the code is free again.
    await sleep(1400);
    const later = await connect();
    expect(await join(later, room, 'uW', 'Wen', { intent: 'join' })).toEqual({ outcome: 'not-found' });
  });

  it('is not taken over by a returning member starting it afresh: the roster, and the Commander, survive', async () => {
    const { room, alpha, uB: bravo, uC: charlie } = await group();
    accept(room, 'uC', { ...WHERE, nextPostWithinSec: 0.3 });
    alpha.disconnect();
    bravo.disconnect();
    charlie.disconnect();
    await sleep(300);

    // Bravo, admitted earlier, comes back first and holds the Group for now.
    const bravo2 = await connect();
    expect(await join(bravo2, room, 'uB', 'NuB')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    report(bravo2, room, WHERE, 'NuB');
    await waitFor(() => keysOf(newest(bravo2)).includes('bg:uC'));

    // The Commander returns and gets the Group back, with nobody re-admitted.
    const alpha2 = await connect();
    expect(await join(alpha2, room, 'uA', 'Alpha')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    // Charlie, admitted earlier and still sharing, needs no approval either.
    const charlie2 = await connect();
    expect(await join(charlie2, room, 'uC', 'NuC')).toMatchObject({ outcome: 'granted', role: 'MEMBER' });
  });

  it('keeps the Group when its last connected member leaves for good and others are still sharing', async () => {
    const { room, alpha, uB: bravo } = await group(['uB']);
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 0.3 });
    bravo.disconnect();
    await sleep(100);
    alpha.emit('leave-squad'); // the Commander leaves; Bravo is the only one left, in the background
    await sleep(300);

    const stranger = await connect();
    expect(await join(stranger, room, 'uZ', 'Zed')).toEqual({ outcome: 'pending' }); // nobody holds it for a stranger
    const bravo2 = await connect();
    expect(await join(bravo2, room, 'uB', 'NuB')).toMatchObject({ outcome: 'granted', role: 'OWNER' }); // first admitted member back
  });

  it('is gone once nobody is connected and nobody is sharing, as before', async () => {
    const { room, alpha, uB: bravo } = await group(['uB']);
    alpha.disconnect();
    bravo.disconnect();
    await sleep(400);
    const later = await connect();
    expect(await join(later, room, 'uW', 'Wen', { intent: 'join' })).toEqual({ outcome: 'not-found' });
  });

  it('an ordinary dropped connection, with no lease, still raises signal-lost at once', async () => {
    const { alpha, uB: bravo } = await group();
    const bravoId = bravo.id;
    bravo.disconnect();
    await waitFor(() => alpha.lost.length, { timeout: 1000 });
    expect(alpha.lost[0]).toMatchObject({ uid: 'uB', targetId: bravoId });
  });
});

describe('how a person stops sharing', () => {
  it('leaving the Group ends it, and they cannot report again', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 0.3 });
    bravo.emit('leave-squad');
    await waitFor(() => !keysOf(newest(alpha)).includes(bravo.id));
    await sleep(100);
    expect(keysOf(newest(alpha))).not.toContain('bg:uB');
    expect(accept(room, 'uB', WHERE)).toEqual({ ok: false, reason: 'not-member' });
  });

  it('being blocked ends it for good, even for someone who is not connected', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 0.3 });
    bravo.disconnect();
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));

    alpha.emit('block-user', { roomCode: room, targetId: 'bg:uB' });
    await waitFor(() => !keysOf(newest(alpha)).includes('bg:uB'));
    expect(accept(room, 'uB', WHERE)).toEqual({ ok: false, reason: 'blocked' });
    const back = await connect();
    expect(await join(back, room, 'uB', 'NuB')).toEqual({ outcome: 'denied' });
    await sleep(100);
    expect(alpha.lost).toEqual([]);
  });

  it('only the Commander can block them', async () => {
    const { room, alpha, uB: bravo, uC: charlie } = await group();
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 0.3 });
    bravo.disconnect();
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));
    charlie.emit('block-user', { roomCode: room, targetId: 'bg:uB' });
    await sleep(150);
    expect(keysOf(newest(alpha))).toContain('bg:uB');
    expect(accept(room, 'uB', WHERE).ok).toBe(true);
  });

  it('the Commander cannot be blocked this way either', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uA', { ...WHERE, nextPostWithinSec: 0.3 });
    alpha.disconnect();
    await waitFor(() => keysOf(newest(bravo)).includes('bg:uA'));
    bravo.emit('block-user', { roomCode: room, targetId: 'bg:uA' });
    await sleep(150);
    expect(keysOf(newest(bravo))).toContain('bg:uA');
  });

  it('the Group voting them out ends it, and they must be admitted again', async () => {
    const { room, alpha, uB: bravo, uC: charlie } = await group();
    accept(room, 'uB', { ...WHERE, nextPostWithinSec: 0.3 });
    bravo.disconnect();
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));
    await sleep(150); // the sweep drops Bravo's dead connection from the count

    alpha.emit('vote-to-kick', { roomCode: room, targetId: 'bg:uB' });
    charlie.emit('vote-to-kick', { roomCode: room, targetId: 'bg:uB' });
    await waitFor(() => !keysOf(newest(alpha)).includes('bg:uB'));
    expect(accept(room, 'uB', WHERE)).toEqual({ ok: false, reason: 'not-member' });
    const back = await connect();
    expect(await join(back, room, 'uB', 'NuB')).toEqual({ outcome: 'pending' }); // asks the Commander afresh
  });

  it('a vote against someone who is neither connected nor sharing does nothing', async () => {
    const { room, alpha, uC: charlie } = await group();
    alpha.emit('vote-to-kick', { roomCode: room, targetId: 'bg:uNobody' });
    charlie.emit('vote-to-kick', { roomCode: room, targetId: 'bg:uNobody' });
    await sleep(150);
    expect(alpha.exiled).toEqual([]);
  });
});

describe('what the server refuses to take', () => {
  it('a report for a Group that is not there, a stranger, or a report with no position', async () => {
    const { room } = await group();
    expect(accept('NOSUCH', 'uB', WHERE)).toEqual({ ok: false, reason: 'no-group' });
    expect(accept(room, 'uStranger', WHERE)).toEqual({ ok: false, reason: 'not-member' });
    expect(accept(room, 'uB', { lat: 'x', lng: 1 })).toEqual({ ok: false, reason: 'bad-report' });
    expect(accept(room, 'uB', undefined)).toEqual({ ok: false, reason: 'bad-report' });
    expect(accept(room, undefined, WHERE)).toEqual({ ok: false, reason: 'not-member' });
    expect(accept('__proto__', 'uB', WHERE)).toEqual({ ok: false, reason: 'no-group' });
    expect(accept('constructor', 'uB', WHERE)).toEqual({ ok: false, reason: 'no-group' });
  });

  it('does not change what a Group shows to anyone when it refuses', async () => {
    const { room, alpha } = await group();
    const before = alpha.updates.length;
    accept(room, 'uStranger', WHERE);
    accept(room, 'uB', { lat: NaN, lng: 1 });
    await sleep(100);
    expect(alpha.updates.length).toBe(before);
  });
});

describe('the Commander\'s telemetry table', () => {
  it('lists people sharing from the background too', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uB', { lat: 12.9, lng: 80.1, battery: 55, nextPostWithinSec: 0.3 });
    bravo.disconnect();
    await waitFor(() => keysOf(newest(alpha)).includes('bg:uB'));
    const table = new Promise((resolve) => alpha.once('telemetry-sync-complete', resolve));
    alpha.emit('request-telemetry', room);
    const telemetry = await table;
    expect(telemetry['bg:uB']).toMatchObject({ latitude: 12.9, longitude: 80.1, batteryLevel: '55%' });
    expect(Object.keys(telemetry)).toContain(alpha.id);
  });

  it('lists a person who is also connected only once', async () => {
    const { room, alpha, uB: bravo } = await group();
    accept(room, 'uB', WHERE);
    const table = new Promise((resolve) => alpha.once('telemetry-sync-complete', resolve));
    alpha.emit('request-telemetry', room);
    const telemetry = await table;
    expect(Object.keys(telemetry)).toContain(bravo.id);
    expect(Object.keys(telemetry)).not.toContain('bg:uB');
  });
});

describe('many people sharing at once', () => {
  it('are all listed, and all go when their leases do', async () => {
    const people = Array.from({ length: 25 }, (_, i) => `m${i}`);
    const { room, alpha, ...members } = await group(people);
    for (const uid of people) {
      expect(accept(room, uid, { ...WHERE, lat: 12.8 + people.indexOf(uid) / 1000 }).ok).toBe(true);
      members[uid].disconnect();
    }
    await waitFor(() => people.every((uid) => keysOf(newest(alpha)).includes(`bg:${uid}`)), { timeout: 4000 });
    expect(keysOf(newest(alpha)).filter((k) => k.startsWith('bg:'))).toHaveLength(25);
    await waitFor(() => alpha.lost.length === 25, { timeout: 4000 });
    expect(new Set(alpha.lost.map((l) => l.uid)).size).toBe(25);
    await waitFor(() => keysOf(newest(alpha)).every((k) => !k.startsWith('bg:')));
  }, 20000);
});
