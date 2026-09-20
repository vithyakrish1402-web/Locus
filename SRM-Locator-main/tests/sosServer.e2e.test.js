import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

/**
 * End-to-end SOS relay: the real backend/server.js in a child process, driven by
 * real Socket.IO clients through the real join / approval flow. Nothing is mocked,
 * so this covers routing, replay and acknowledgement exactly as a phone would hit them.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

const waitFor = async (predicate, { timeout = 3000, interval = 20 } = {}) => {
  const start = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await sleep(interval);
  }
};

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

let server;
let url;
const clients = [];
let roomSeq = 0;
const newRoom = () => `E2E${++roomSeq}`;

beforeAll(async () => {
  const port = await freePort();
  url = `http://localhost:${port}`;
  server = spawn(process.execPath, ['backend/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    server.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('running on port')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}, 15000);

afterEach(() => {
  clients.splice(0).forEach((s) => s.disconnect());
});

afterAll(() => {
  server?.kill();
});

const connect = async () => {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  socket.sos = [];
  socket.on('sos-received', (payload) => socket.sos.push(payload));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  clients.push(socket);
  return socket;
};

const createSquad = async (socket, room, uid) => {
  const granted = once(socket, 'access-granted');
  socket.emit('request-join', { roomCode: room, user: { uid, name: uid } });
  await granted;
};

// A genuine joiner: knocks, the Commander approves, and — like the app — asks the
// server to catch it up on any SOS it missed as soon as it's let in.
const admit = async (owner, socket, room, uid) => {
  const request = once(owner, 'access-request');
  const granted = once(socket, 'access-granted');
  socket.emit('request-join', { roomCode: room, user: { uid, name: uid } });
  const { targetId } = await request;
  owner.emit('resolve-access', { targetId, roomCode: room, approved: true });
  await granted;
  socket.emit('sos-sync');
};

const fireSos = (socket, room, extra = {}) =>
  socket.emit('sos-broadcast', { senderName: 'Bravo', lat: 12.8231, lng: 80.0442, roomCode: room, timestamp: Date.now(), ...extra });

// A three-person squad: Alpha (Commander), Bravo and Charlie.
const squadOfThree = async () => {
  const room = newRoom();
  const [alpha, bravo, charlie] = [await connect(), await connect(), await connect()];
  await createSquad(alpha, room, 'uA');
  await admit(alpha, bravo, room, 'uB');
  await admit(alpha, charlie, room, 'uC');
  return { room, alpha, bravo, charlie };
};

describe('SOS routing', () => {
  it('reaches every other member, not the sender and not another squad', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const otherRoom = newRoom();
    const delta = await connect();
    await createSquad(delta, otherRoom, 'uD');

    // Bravo never sent update-location, i.e. has no GPS fix and no `users` entry —
    // the case where the old server silently dropped the beacon.
    fireSos(bravo, room);

    await waitFor(() => alpha.sos.length && charlie.sos.length);
    expect(alpha.sos[0]).toMatchObject({ senderName: 'Bravo', lat: 12.8231, lng: 80.0442, ageMs: 0 });
    expect(alpha.sos[0].id).toBeTruthy();
    expect(charlie.sos[0].id).toBe(alpha.sos[0].id);
    await sleep(250);
    expect(bravo.sos).toEqual([]);
    expect(delta.sos).toEqual([]);
  });

  it('delivers when the sender has no coordinates at all', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    fireSos(bravo, room, { lat: null, lng: null });
    await waitFor(() => alpha.sos.length);
    expect(alpha.sos[0]).toMatchObject({ lat: null, lng: null });
  });

  it('ignores a claimed roomCode the sender is not a member of', async () => {
    const { alpha, bravo } = await squadOfThree();
    const otherRoom = newRoom();
    const delta = await connect();
    await createSquad(delta, otherRoom, 'uD');

    fireSos(bravo, otherRoom); // Bravo is not in otherRoom
    await waitFor(() => alpha.sos.length); // ...so it goes to Bravo's own squad instead
    await sleep(250);
    expect(delta.sos).toEqual([]);
  });

  it('drops an SOS from a socket that is in no squad', async () => {
    const { room, alpha, charlie } = await squadOfThree();
    const stranger = await connect();
    fireSos(stranger, room);
    await sleep(300);
    expect(alpha.sos).toEqual([]);
    expect(charlie.sos).toEqual([]);
  });

  it('survives an empty sos-broadcast and keeps relaying afterwards', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    bravo.emit('sos-broadcast'); // no payload at all
    await sleep(150);
    expect(server.exitCode).toBeNull();
    alpha.sos.length = 0;
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.some((s) => s.senderName === 'Bravo'));
  });
});

describe('SOS replay for members who missed it', () => {
  it('catches up a member who was offline, and reports how old it is', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    charlie.disconnect();

    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length);
    await sleep(100);

    // Charlie comes back on a new socket (new socket id, same person) and is re-approved.
    const charlie2 = await connect();
    await admit(alpha, charlie2, room, 'uC');

    await waitFor(() => charlie2.sos.length);
    expect(charlie2.sos[0].id).toBe(alpha.sos[0].id);
    expect(charlie2.sos[0].senderName).toBe('Bravo');
    expect(charlie2.sos[0].ageMs).toBeGreaterThanOrEqual(50);
  });

  it('catches up a member who is approved into the squad after it fired', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length);

    const newcomer = await connect();
    await admit(alpha, newcomer, room, 'uN');
    await waitFor(() => newcomer.sos.length);
    expect(newcomer.sos[0].senderName).toBe('Bravo');
  });

  it('does not replay to the sender, even after they reconnect', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length);

    bravo.emit('sos-sync');
    bravo.disconnect();
    const bravo2 = await connect();
    await admit(alpha, bravo2, room, 'uB');
    await sleep(300);
    expect(bravo.sos).toEqual([]);
    expect(bravo2.sos).toEqual([]);
  });

  it('replays nothing when there is nothing outstanding', async () => {
    const { alpha } = await squadOfThree();
    alpha.emit('sos-sync');
    await sleep(250);
    expect(alpha.sos).toEqual([]);
  });

  it('ignores a sync from a socket that is in no squad', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length);
    const stranger = await connect();
    stranger.emit('sos-sync');
    await sleep(250);
    expect(stranger.sos).toEqual([]);
  });
});

describe('SOS acknowledgement', () => {
  it('stops replaying once a member acknowledges — and that survives a reconnect', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => charlie.sos.length);

    charlie.emit('sos-ack', { id: charlie.sos[0].id });
    charlie.disconnect();

    const charlie2 = await connect();
    await admit(alpha, charlie2, room, 'uC');
    await sleep(300);
    expect(charlie2.sos).toEqual([]);
  });

  it('keeps replaying to members who have not acknowledged yet', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length && charlie.sos.length);

    // Charlie acknowledges; Alpha does not, then reconnects.
    charlie.emit('sos-ack', { id: charlie.sos[0].id });
    alpha.sos.length = 0;
    alpha.emit('sos-sync');
    await waitFor(() => alpha.sos.length);
    expect(alpha.sos[0].senderName).toBe('Bravo');
  });

  it('a re-triggered SOS is a new alert everyone still owes an acknowledgement for', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => charlie.sos.length);
    charlie.emit('sos-ack', { id: charlie.sos[0].id });

    fireSos(bravo, room);
    await waitFor(() => charlie.sos.length === 2);
    expect(charlie.sos[1].id).not.toBe(charlie.sos[0].id);

    charlie.sos.length = 0;
    charlie.emit('sos-sync');
    await waitFor(() => charlie.sos.length === 1);
    expect(alpha.sos).toHaveLength(2);
  });

  it('shrugs off acknowledgements from strangers and for made-up ids', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => charlie.sos.length);
    const { id } = charlie.sos[0];

    const stranger = await connect();
    stranger.emit('sos-ack', { id }); // not in any squad
    charlie.emit('sos-ack', { id: 'not-a-real-id' });
    charlie.emit('sos-ack'); // no payload
    await sleep(150);
    expect(server.exitCode).toBeNull();

    // None of that acknowledged anything: Charlie still gets it on sync.
    charlie.sos.length = 0;
    charlie.emit('sos-sync');
    await waitFor(() => charlie.sos.length);
    expect(charlie.sos[0].id).toBe(id);
    expect(alpha.sos[0].id).toBe(id);
  });
});
