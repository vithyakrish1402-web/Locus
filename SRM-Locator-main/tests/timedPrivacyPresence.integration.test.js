import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as connectIo } from 'socket.io-client';
import { sleep, waitFor } from './helpers/e2eServer.js';

/**
 * Timed Pause and Hidden for someone sharing from the background (the app closed): the real
 * backend/server.js inside this test, real Socket.IO clients, and the server's own function for a
 * background report (acceptBackgroundPosition), as presence.integration.test.js does. A hold
 * "minute" is 100 ms; leases are fractions of a second.
 */
Object.assign(process.env, {
  PORT: '0',
  LOCUS_JOIN_ATTEMPTS_PER_MIN: '0',
  LOCUS_JOIN_ATTEMPTS_PER_MIN_PER_ADDRESS: '0',
  LOCUS_MAX_SOCKETS_PER_IP: '0',
  LOCUS_LEASE_MIN_SEC: '0.4',
  LOCUS_LEASE_MAX_SEC: '1',
  LOCUS_PRESENCE_CHECK_MS: '30',
  LOCUS_TIMED_PRIVACY_ENABLED: 'true',
  LOCUS_HOLD_MINUTE_MS: '100',
  LOCUS_HOLD_SWEEP_MS: '20',
});

let url;
let accept;
let stopServer;
const clients = [];
let seq = 0;

beforeAll(async () => {
  const server = await import('../backend/server.js');
  accept = server.acceptBackgroundPosition;
  stopServer = server.stopServer;
  url = `http://localhost:${await server.listening}`;
});
afterEach(() => clients.splice(0).forEach((s) => s.disconnect()));
afterAll(() => stopServer());

const P1 = { lat: 12.8222, lng: 80.0436 };
const P2 = { lat: 12.8300, lng: 80.0500 };

const connect = async () => {
  const socket = connectIo(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  Object.assign(socket, { roster: {}, lost: [] });
  socket.on('users-update', (p) => { socket.roster = p; });
  socket.on('member-signal-lost', (p) => socket.lost.push(p));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  clients.push(socket);
  return socket;
};
const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

// Alpha leads; Bravo is a member with a position, about to close the app.
const group = async () => {
  const n = ++seq;
  const room = `TPP${n}`;
  const uB = `uB${n}`;
  const alpha = await connect();
  const bravo = await connect();
  await new Promise((resolve) => {
    alpha.once('access-granted', resolve);
    alpha.emit('request-join', { roomCode: room, user: { uid: `uA${n}`, name: 'Alpha' }, intent: 'create' });
  });
  const request = new Promise((resolve) => alpha.once('access-request', resolve));
  const granted = new Promise((resolve) => bravo.once('access-granted', resolve));
  bravo.emit('request-join', { roomCode: room, user: { uid: uB, name: 'Bravo' } });
  alpha.emit('resolve-access', { targetId: (await request).targetId, roomCode: room, approved: true });
  await granted;
  bravo.emit('update-location', { roomCode: room, ...P1, status: 'ACTIVE', heading: 0, battery: 90 });
  await waitFor(() => Object.values(alpha.roster).some((e) => e.uid === uB && e.hasFix));
  return { room, alpha, bravo, uB };
};

describe('a hold, once the app is closed and sharing goes on from the background', () => {
  it('Hidden: the background position is never shown, and the lease running out is not announced', async () => {
    const { room, alpha, bravo, uB } = await group();
    expect((await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 20 })).ok).toBe(true);
    bravo.disconnect();
    expect(accept(room, uB, { ...P2, status: 'ACTIVE', nextPostWithinSec: 0.1 })).toMatchObject({ ok: true });
    await waitFor(() => alpha.roster[`bg:${uB}`]);
    expect(alpha.roster[`bg:${uB}`]).toMatchObject({ status: 'GHOST', hasFix: false });
    expect(alpha.roster[`bg:${uB}`].lat).toBeUndefined();
    expect(alpha.roster[`bg:${uB}`].holdUntil).toBeGreaterThan(Date.now());
    // The lease lapses (0.4 s): no lost-signal notice carrying where they are.
    await waitFor(() => !alpha.roster[`bg:${uB}`], { timeout: 2000 });
    await sleep(50);
    expect(alpha.lost).toEqual([]);
  });

  it('Paused: the background report shows only the spot paused at, and the hold ends by itself', async () => {
    const { room, alpha, bravo, uB } = await group();
    expect((await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'FROZEN', minutes: 3 })).ok).toBe(true);
    bravo.disconnect();
    accept(room, uB, { ...P2, status: 'FROZEN', nextPostWithinSec: 0.3 });
    await waitFor(() => alpha.roster[`bg:${uB}`]);
    expect(alpha.roster[`bg:${uB}`]).toMatchObject({ status: 'FROZEN', hasFix: true, lat: P1.lat, lng: P1.lng });
    // 300 ms later the hold is over: Live, and the service's next live report is shown as it is.
    await sleep(350);
    accept(room, uB, { ...P2, status: 'ACTIVE', nextPostWithinSec: 0.3 });
    await waitFor(() => alpha.roster[`bg:${uB}`]?.lat === P2.lat);
    expect(alpha.roster[`bg:${uB}`]).toMatchObject({ status: 'ACTIVE', hasFix: true });
    expect(alpha.roster[`bg:${uB}`].holdUntil).toBeUndefined();
  });

  it('a background Pause never granted is listed without a position', async () => {
    const { room, alpha, bravo, uB } = await group();
    bravo.disconnect();
    accept(room, uB, { ...P2, status: 'FROZEN', nextPostWithinSec: 0.3 });
    await waitFor(() => alpha.roster[`bg:${uB}`]);
    expect(alpha.roster[`bg:${uB}`]).toMatchObject({ status: 'ACTIVE', hasFix: false });
  });
});
