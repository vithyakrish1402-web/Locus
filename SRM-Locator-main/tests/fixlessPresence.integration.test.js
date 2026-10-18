import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as connectIo } from 'socket.io-client';
import { sleep, waitFor } from './helpers/e2eServer.js';

/**
 * Someone opens LOCUS again while their background sharing is paused. Their new connection has no
 * position to send (a paused app sends nothing newer than where it paused), and their background
 * service reports the paused spot. The Group must see that paused spot, once, on the map: the
 * position-less connection used to hide it, leaving them in the list and off the map.
 * The real backend/server.js inside this test, real sockets, the real join flow.
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

const PAUSED_AT = { lat: 12.8, lng: 80.0 };
const LIVE_NOW = { lat: 12.81, lng: 80.01 };
const newRoom = () => `NOFIX${++roomSeq}`;

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
  socket.once('access-granted', (p) => resolve(p));
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
const newest = (socket) => socket.updates[socket.updates.length - 1] ?? {};
const entriesFor = (update, uid) => Object.entries(update).filter(([, v]) => v.uid === uid);

// Alpha (Group Lead) and Bravo; Bravo paused from the notification, swiped the app away, and
// opened it again: a new connection with nothing to report, the service holding the paused spot.
const reopenedWhilePaused = async () => {
  const room = newRoom();
  const alpha = await connect();
  await join(alpha, room, 'uA', 'Alpha', { intent: 'create' });
  const bravo = await connect();
  await admit(alpha, bravo, room, 'uB', 'Bravo');
  bravo.emit('update-location', { ...PAUSED_AT, name: 'Bravo', roomCode: room, heading: 0, battery: 90, status: 'ACTIVE' });
  accept(room, 'uB', { ...PAUSED_AT, status: 'FROZEN', nextPostWithinSec: 5 });
  bravo.disconnect();
  const again = await connect();
  await join(again, room, 'uB', 'Bravo', { intent: 'join' });
  // The service, started again for the same Group, reports the paused spot at once.
  accept(room, 'uB', { ...PAUSED_AT, status: 'FROZEN', nextPostWithinSec: 5 });
  return { room, alpha, again };
};

describe('opened again while paused: a connection with no position, a paused background spot', () => {
  it('the Group sees the paused spot, once, on the map', async () => {
    const { alpha } = await reopenedWhilePaused();
    await waitFor(() => entriesFor(newest(alpha), 'uB')[0]?.[1].presence === true);
    const shown = entriesFor(newest(alpha), 'uB');
    expect(shown).toHaveLength(1);
    expect(shown[0][1]).toMatchObject({ status: 'FROZEN', hasFix: true, lat: PAUSED_AT.lat, lng: PAUSED_AT.lng });
  });

  it('never two entries for the person in anything the Group was sent', async () => {
    const { alpha } = await reopenedWhilePaused();
    await sleep(200);
    for (const update of alpha.updates) expect(entriesFor(update, 'uB').length).toBeLessThanOrEqual(1);
  });

  it('once the app reports a position again (Live), that is shown instead, still once', async () => {
    const { room, alpha, again } = await reopenedWhilePaused();
    await waitFor(() => entriesFor(newest(alpha), 'uB')[0]?.[1].presence === true);
    again.emit('update-location', { ...LIVE_NOW, name: 'Bravo', roomCode: room, heading: 0, battery: 90, status: 'ACTIVE' });
    await waitFor(() => entriesFor(newest(alpha), 'uB')[0]?.[1].lat === LIVE_NOW.lat);
    const shown = entriesFor(newest(alpha), 'uB');
    expect(shown).toHaveLength(1);
    expect(shown[0][1].presence).toBeUndefined();
  });

  it('the Group Lead\'s telemetry table has the paused spot too', async () => {
    const { room, alpha } = await reopenedWhilePaused();
    const table = new Promise((resolve) => alpha.once('telemetry-sync-complete', resolve));
    alpha.emit('request-telemetry', room);
    const rows = Object.values(await table);
    expect(rows.some((r) => r.latitude === PAUSED_AT.lat && r.longitude === PAUSED_AT.lng)).toBe(true);
  });

  it('a position the same person sends in another Group does not hide the paused spot here', async () => {
    // Bravo also on another Group (a second phone, or a connection not yet noticed as dead), with a position there.
    const other = newRoom();
    const lead = await connect();
    await join(lead, other, 'uX', 'Xray', { intent: 'create' });
    const elsewhere = await connect();
    await admit(lead, elsewhere, other, 'uB', 'Bravo');
    elsewhere.emit('update-location', { ...LIVE_NOW, name: 'Bravo', roomCode: other, heading: 0, battery: 90, status: 'ACTIVE' });
    await waitFor(() => entriesFor(newest(lead), 'uB')[0]?.[1].hasFix === true);
    const { alpha } = await reopenedWhilePaused();
    await waitFor(() => entriesFor(newest(alpha), 'uB')[0]?.[1].presence === true);
    expect(entriesFor(newest(alpha), 'uB')).toHaveLength(1);
    expect(entriesFor(newest(alpha), 'uB')[0][1]).toMatchObject({ status: 'FROZEN', lat: PAUSED_AT.lat });
  });

  it('unchanged: a live (not paused) service does not take over from a connection waiting for its first fix', async () => {
    const room = newRoom();
    const alpha = await connect();
    await join(alpha, room, 'uA', 'Alpha', { intent: 'create' });
    const bravo = await connect();
    await admit(alpha, bravo, room, 'uB', 'Bravo'); // no location sent
    accept(room, 'uB', { ...LIVE_NOW, status: 'ACTIVE', nextPostWithinSec: 5 });
    await sleep(100);
    expect(newest(alpha)[bravo.id]).toMatchObject({ uid: 'uB', hasFix: false });
    expect(newest(alpha)['bg:uB']).toBeUndefined();
  });

  it('unchanged: a connection that has a position hides an older background entry', async () => {
    const room = newRoom();
    const alpha = await connect();
    await join(alpha, room, 'uA', 'Alpha', { intent: 'create' });
    const bravo = await connect();
    await admit(alpha, bravo, room, 'uB', 'Bravo');
    accept(room, 'uB', { ...PAUSED_AT, status: 'FROZEN', nextPostWithinSec: 5 });
    bravo.emit('update-location', { ...LIVE_NOW, name: 'Bravo', roomCode: room, heading: 0, battery: 90, status: 'ACTIVE' });
    await waitFor(() => entriesFor(newest(alpha), 'uB')[0]?.[1].lat === LIVE_NOW.lat);
    expect(entriesFor(newest(alpha), 'uB')).toHaveLength(1);
    expect(entriesFor(newest(alpha), 'uB')[0][1].presence).toBeUndefined();
  });
});
