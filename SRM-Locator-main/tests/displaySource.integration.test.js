import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as connectIo } from 'socket.io-client';
import { sleep, waitFor } from './helpers/e2eServer.js';

/**
 * Which of a person's feeds the Group sees (backend/displaySource.js), end to end: the real
 * backend/server.js running inside this test, real sockets, the real join flow. The threshold
 * and the dwell are shortened from seconds to fractions of one.
 */
Object.assign(process.env, {
  PORT: '0',
  LOCUS_LIVE_STALE_SEC: '0.25',
  LOCUS_SOURCE_DWELL_SEC: '1.2',
  LOCUS_LEASE_MIN_SEC: '10',
  LOCUS_LEASE_MAX_SEC: '20',
  LOCUS_PRESENCE_CHECK_MS: '30',
  LOCUS_SWEEP_INTERVAL_MS: '100',
  LOCUS_ROOM_TTL_MS: '5000',
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

const OLD = { lat: 12.8, lng: 80.0 };
const NEW = { lat: 12.81, lng: 80.01 };
const newRoom = () => `FRESH${++roomSeq}`;

const connect = async () => {
  const socket = connectIo(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  Object.assign(socket, { updates: [] });
  socket.on('users-update', (p) => socket.updates.push(p));
  const keepAlive = setInterval(() => socket.connected && socket.emit('check-ping', Date.now()), 100);
  socket.on('disconnect', () => clearInterval(keepAlive));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  clients.push(socket);
  return socket;
};

const join = (socket, room, uid, name, extra = {}) => new Promise((resolve) => {
  socket.once('access-granted', (p) => resolve({ outcome: 'granted', ...p }));
  socket.emit('request-join', { roomCode: room, user: { uid, name }, ...extra });
});
const admit = async (owner, socket, room, uid, name) => {
  const request = new Promise((resolve) => owner.once('access-request', resolve));
  const granted = new Promise((resolve) => socket.once('access-granted', resolve));
  socket.emit('request-join', { roomCode: room, user: { uid, name } });
  const { targetId } = await request;
  owner.emit('resolve-access', { targetId, roomCode: room, approved: true });
  await granted;
};
const report = (socket, room, where, name) => socket.emit('update-location', { ...where, name, roomCode: room, heading: 0, battery: 90 });
const newest = (socket) => socket.updates[socket.updates.length - 1] ?? {};
const entriesFor = (update, uid) => Object.entries(update).filter(([, v]) => v.uid === uid);

// Alpha (Commander) and Bravo, both located at OLD.
const pair = async () => {
  const room = newRoom();
  const alpha = await connect();
  await join(alpha, room, 'uA', 'Alpha', { intent: 'create' });
  const bravo = await connect();
  await admit(alpha, bravo, room, 'uB', 'Bravo');
  report(bravo, room, OLD, 'Bravo');
  report(alpha, room, OLD, 'Alpha');
  await waitFor(() => Object.keys(newest(alpha)).length === 2 && entriesFor(newest(alpha), 'uB')[0]?.[1].lat === OLD.lat);
  return { room, alpha, bravo };
};

// Never two markers for one person, in any update the Group ever got.
const neverTwoMarkers = (socket, uid) => {
  for (const update of socket.updates) expect(entriesFor(update, uid).length).toBeLessThanOrEqual(1);
};

describe('a live socket that has gone quiet while the background service reports', () => {
  it('shows the fresher background position, as one marker, once the socket is stale', async () => {
    const { room, alpha, bravo } = await pair();
    await sleep(400); // longer than the 0.25 s threshold: the socket is behind
    accept(room, 'uB', NEW);
    await waitFor(() => newest(alpha)['bg:uB']);
    const update = newest(alpha);
    expect(update['bg:uB']).toMatchObject({ lat: NEW.lat, lng: NEW.lng, uid: 'uB', presence: true });
    expect(update[bravo.id]).toBeUndefined();
    expect(entriesFor(update, 'uB')).toHaveLength(1);
    neverTwoMarkers(alpha, 'uB');
  });

  it('keeps showing the socket while it is recent, whatever the service reports', async () => {
    const { room, alpha, bravo } = await pair();
    accept(room, 'uB', NEW); // straight after the socket's own update: not stale
    await sleep(100);
    expect(newest(alpha)[bravo.id]).toMatchObject({ lat: OLD.lat });
    expect(newest(alpha)['bg:uB']).toBeUndefined();
    neverTwoMarkers(alpha, 'uB');
  });

  it('changes nothing when there is no presence record, however stale the socket', async () => {
    const { room, alpha, bravo } = await pair();
    await sleep(500);
    report(alpha, room, OLD, 'Alpha'); // any traffic to cause a broadcast
    await sleep(100);
    expect(newest(alpha)[bravo.id]).toMatchObject({ lat: OLD.lat, uid: 'uB' });
    expect(Object.keys(newest(alpha)).some((k) => k.startsWith('bg:'))).toBe(false);
  });

  it('does not flap when the two feeds leapfrog each other', async () => {
    const { room, alpha, bravo } = await pair();
    // The socket updates every 800 ms (always past the 250 ms threshold by the time the service
    // reports), the service every 400 ms in between. Without the dwell every socket update would
    // pull the marker back and every service report push it away again.
    const start = Date.now();
    const events = [];
    for (let t = 300; t < 5000; t += 400) events.push({ t, kind: 'service' });
    for (let t = 800; t < 5000; t += 800) events.push({ t, kind: 'socket' });
    events.sort((x, y) => x.t - y.t);
    await sleep(Math.max(0, 300 - (Date.now() - start)));
    const seq = [];
    let n = 0;
    for (const e of events) {
      await sleep(Math.max(0, e.t - (Date.now() - start)));
      n += 1;
      const where = { lat: 12.8 + n * 0.001, lng: 80.0 };
      if (e.kind === 'service') accept(room, 'uB', where); else report(bravo, room, where, 'Bravo');
      await sleep(30);
      const entries = entriesFor(newest(alpha), 'uB');
      expect(entries).toHaveLength(1);
      seq.push(entries[0][0] === 'bg:uB' ? 'P' : 'L');
    }
    const switches = seq.filter((s, i) => i > 0 && s !== seq[i - 1]).length;
    // Over 5 s, switching on every event pair would be about 10; with a 1.2 s dwell it is a handful.
    expect(switches).toBeLessThanOrEqual(5);
    neverTwoMarkers(alpha, 'uB');
  });

  it('leaves a member who has no fix yet exactly as before, even when the service reports', async () => {
    const room = newRoom();
    const alpha = await connect();
    await join(alpha, room, 'uA', 'Alpha', { intent: 'create' });
    const bravo = await connect();
    await admit(alpha, bravo, room, 'uB', 'Bravo'); // no location sent
    report(alpha, room, OLD, 'Alpha');
    await sleep(400);
    accept(room, 'uB', NEW);
    await sleep(100);
    expect(newest(alpha)[bravo.id]).toMatchObject({ uid: 'uB', hasFix: false });
    expect(newest(alpha)['bg:uB']).toBeUndefined();
    neverTwoMarkers(alpha, 'uB');
  });

  it('goes back to the socket once it has caught up after the dwell', async () => {
    const { room, alpha, bravo } = await pair();
    await sleep(400);
    accept(room, 'uB', NEW);
    await waitFor(() => newest(alpha)['bg:uB']);
    await sleep(1300); // past the dwell
    report(bravo, room, { lat: 12.9, lng: 80.2 }, 'Bravo');
    await waitFor(() => newest(alpha)[bravo.id]);
    expect(newest(alpha)[bravo.id]).toMatchObject({ lat: 12.9 });
    expect(newest(alpha)['bg:uB']).toBeUndefined();
    neverTwoMarkers(alpha, 'uB');
  });

  it('answers the Commander telemetry request with the same choice', async () => {
    const { room, alpha, bravo } = await pair();
    await sleep(400);
    accept(room, 'uB', NEW);
    await waitFor(() => newest(alpha)['bg:uB']);
    const table = new Promise((resolve) => alpha.once('telemetry-sync-complete', resolve));
    alpha.emit('request-telemetry', room);
    const sync = await table;
    expect(sync['bg:uB']).toBeDefined();
    expect(sync[bravo.id]).toBeUndefined();
  });
});
