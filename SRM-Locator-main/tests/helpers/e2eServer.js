import { beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

/**
 * Shared harness for the end-to-end tests: the real backend/server.js in a child
 * process on a free port, driven by real Socket.IO clients. Nothing is mocked.
 *
 * Call e2eServer() at the top level of a test file; it registers its own
 * beforeAll/afterEach/afterAll and returns the helpers.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));

// A round trip on this connection. The server handles one socket's events strictly in
// order, so once the reply is back, everything this socket sent before it has been
// processed. Use it instead of sleeping and hoping — in particular before disconnecting,
// so a just-sent event can't be overtaken by the same person's next connection (separate
// connections have no ordering guarantee between them).
export const settle = (socket) =>
  new Promise((resolve) => {
    socket.once('pong-bounce', resolve);
    socket.emit('check-ping', Date.now());
  });

export const waitFor = async (predicate, { timeout = 3000, interval = 20 } = {}) => {
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

export function e2eServer() {
  let server;
  let url;
  const clients = [];
  let roomSeq = 0;

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

  // A fresh connection. `socket.sos` collects every 'sos-received' it gets.
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

  // A genuine first-time joiner: knocks, the Commander approves, and — like the app —
  // asks the server to catch it up on any SOS it missed as soon as it's let in.
  const admit = async (owner, socket, room, uid) => {
    const request = once(owner, 'access-request');
    const granted = once(socket, 'access-granted');
    socket.emit('request-join', { roomCode: room, user: { uid, name: uid } });
    const { targetId } = await request;
    owner.emit('resolve-access', { targetId, roomCode: room, approved: true });
    await granted;
    socket.emit('sos-sync');
  };

  // Sends a join request and reports what the server decided:
  // { outcome: 'granted' | 'pending' | 'denied', role? }.
  const requestJoin = (socket, room, uid) =>
    new Promise((resolve) => {
      socket.once('access-granted', (p) => resolve({ outcome: 'granted', ...p }));
      socket.once('access-pending', () => resolve({ outcome: 'pending' }));
      socket.once('access-denied', () => resolve({ outcome: 'denied' }));
      socket.emit('request-join', { roomCode: room, user: { uid, name: uid } });
    });

  // A previously approved member coming back on a new socket. No Commander involved;
  // like the app, they ask for their missed SOS once let in.
  const returnToSquad = async (socket, room, uid) => {
    const result = await requestJoin(socket, room, uid);
    if (result.outcome === 'granted') socket.emit('sos-sync');
    return result;
  };

  const newRoom = () => `E2E${++roomSeq}`;

  // A three-person squad on its own room: Alpha (Commander, uid uA), Bravo (uB), Charlie (uC).
  const squadOfThree = async () => {
    const room = newRoom();
    const [alpha, bravo, charlie] = [await connect(), await connect(), await connect()];
    await createSquad(alpha, room, 'uA');
    await admit(alpha, bravo, room, 'uB');
    await admit(alpha, charlie, room, 'uC');
    return { room, alpha, bravo, charlie };
  };

  return {
    connect,
    createSquad,
    admit,
    requestJoin,
    returnToSquad,
    squadOfThree,
    newRoom,
    serverIsAlive: () => server.exitCode === null,
  };
}
