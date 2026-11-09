import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, settle, once } from './helpers/e2eServer.js';

/**
 * End-to-end checks for the server-side leads of the 2026-11 security audit (run 1). Each
 * describe names the lead it covers. The real backend/server.js, real sockets, dummy uids.
 */

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const collect = (socket, event) => {
  const seen = [];
  socket.on(event, (p) => seen.push(p ?? {}));
  return seen;
};

describe('a Group code that names someone else\'s connection', () => {
  const api = e2eServer();

  it('is refused, so the creator never hears what is sent to that person', async () => {
    const { room, alpha, charlie } = await api.squadOfThree();
    const outsider = await api.connect();
    const granted = collect(outsider, 'access-granted');
    // A code equal to Alpha's socket id would subscribe the outsider to Alpha's private room.
    outsider.emit('request-join', { roomCode: alpha.id, intent: 'create', user: { uid: 'uX', name: 'X' } });
    await settle(outsider);
    expect(granted).toEqual([]);

    charlie.emit('sos-broadcast', { roomCode: room, lat: 12.82, lng: 80.04, clientId: 'c1' });
    await waitFor(() => alpha.sos.length === 1);
    await settle(outsider);
    expect(outsider.sos).toEqual([]);
  });
});

describe('the stand-in who holds command while the Commander is away', () => {
  const api = e2eServer();

  it('cannot be kicked by a moderator who names them by their background-sharing key', async () => {
    const { room, alpha, bravo, charlie } = await api.squadOfThree();
    expect(await ask(alpha, 'set-moderator', { roomCode: room, targetId: bravo.id, moderator: true })).toEqual({ ok: true });
    alpha.disconnect();
    charlie.disconnect();
    const charlie2 = await api.connect();
    expect(await api.requestJoin(charlie2, room, 'uC')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    const exiled = collect(charlie2, 'exiled');
    expect(await ask(bravo, 'kick-member', { roomCode: room, targetId: 'bg:uC' })).toMatchObject({ ok: false, reason: 'not-allowed' });
    await settle(charlie2);
    expect(exiled).toEqual([]);
  });
});

describe('a member whose connection is re-labelled by a join that goes nowhere', () => {
  const api = e2eServer();

  // Victor raises an SOS; Bravo then sends a join naming Victor's uid. Bravo's own SOS must
  // stay Bravo's, not be merged into (and overwrite) Victor's.
  const setUp = async () => {
    const { room, alpha, bravo, charlie } = await api.squadOfThree();
    const victor = await api.connect();
    await api.admit(alpha, victor, room, 'uV');
    victor.emit('sos-broadcast', { roomCode: room, lat: 12.8, lng: 80.0, clientId: 'v1' });
    await waitFor(() => charlie.sos.length === 1);
    return { room, alpha, bravo, charlie, victor };
  };
  const bravoRaisesSos = async ({ room, bravo, charlie }) => {
    const updated = collect(charlie, 'sos-updated');
    bravo.emit('sos-broadcast', { roomCode: room, lat: 13.0, lng: 80.2, clientId: 'b1' });
    await waitFor(() => charlie.sos.length === 2 || updated.length > 0);
    await settle(charlie);
    expect(updated).toEqual([]);
    expect(charlie.sos[1]).toMatchObject({ senderId: bravo.id, lat: 13.0, lng: 80.2 });
  };

  it('a refused join (no such Group) does not change whose SOS theirs is', async () => {
    const g = await setUp();
    g.bravo.emit('request-join', { roomCode: 'NOSUCH9', intent: 'join', user: { uid: 'uV', name: 'uV' } });
    await settle(g.bravo);
    await bravoRaisesSos(g);
  });

  it('a join left waiting in another Group does not change whose SOS theirs is', async () => {
    const g = await setUp();
    const other = await api.connect();
    const room2 = api.newRoom();
    await api.createSquad(other, room2, 'uO');
    const pending = once(g.bravo, 'access-pending');
    g.bravo.emit('request-join', { roomCode: room2, intent: 'join', user: { uid: 'uV', name: 'uV' } });
    await pending;
    await bravoRaisesSos(g);
  });
});

describe('what an SOS carries to everyone else', () => {
  const api = e2eServer();

  it('carries the name the sender joined with (never the one in the message), and only a real position', async () => {
    const { room, bravo, charlie } = await api.squadOfThree();
    let deep = 1;
    for (let i = 0; i < 5; i += 1) deep = [deep]; // nested, but within what the server accepts at all
    bravo.emit('sos-broadcast', { roomCode: room, senderName: 'x'.repeat(40_000), lat: deep, lng: 80.0, timestamp: { a: 1 }, clientId: 'b1' });
    await waitFor(() => charlie.sos.length === 1);
    expect(charlie.sos[0].senderName).toBe('uB');
    expect(charlie.sos[0].lat).toBeNull();
    expect(charlie.sos[0].lng).toBeNull();
    expect(typeof charlie.sos[0].timestamp).toBe('number');
  });
});

describe('what a position report carries to everyone else', () => {
  const api = e2eServer();

  it('is only the fields the app shows, never whatever else the sender attached', async () => {
    const { room, alpha, bravo } = await api.squadOfThree();
    const updates = collect(alpha, 'users-update');
    bravo.emit('update-location', {
      roomCode: room, lat: 12.82, lng: 80.04, name: 'uB', speed: 3, battery: 80, heading: 90, status: 'ACTIVE',
      pad: 'x'.repeat(50_000), nested: { deep: [1, 2, 3] },
    });
    await waitFor(() => updates.some((u) => u[bravo.id]?.lat === 12.82));
    const entry = updates.find((u) => u[bravo.id]?.lat === 12.82)[bravo.id];
    expect(entry).toMatchObject({ lat: 12.82, lng: 80.04, speed: 3, battery: 80, heading: 90, status: 'ACTIVE', name: 'uB' });
    expect(entry).not.toHaveProperty('pad');
    expect(entry).not.toHaveProperty('nested');
  });
});

describe("'resume' for a Group code nobody here has commanded", () => {
  const api = e2eServer({ env: { LOCUS_MAX_GROUPS_PER_HOUR: '2' } });

  it('counts against the founding limit like a new Group', async () => {
    const socket = await api.connect();
    const answers = [];
    for (let i = 0; i < 4; i += 1) {
      const room = api.newRoom();
      const answer = new Promise((resolve) => {
        socket.once('access-granted', () => resolve('granted'));
        socket.once('join-refused', (p) => resolve(p.reason));
      });
      socket.emit('request-join', { roomCode: room, intent: 'resume', user: { uid: 'uR', name: 'R' } });
      answers.push(await answer);
      socket.removeAllListeners('access-granted');
      socket.removeAllListeners('join-refused');
    }
    expect(answers).toEqual(['granted', 'granted', 'too-many-groups', 'too-many-groups']);
  });
});

describe('a Group code after its Group has ended', () => {
  const api = e2eServer({ env: { LOCUS_EMPTY_GROUP_GRACE_MS: '150', LOCUS_SWEEP_INTERVAL_MS: '50' } });

  const endedGroup = async () => {
    const room = api.newRoom();
    const alpha = await api.connect();
    await api.createSquad(alpha, room, 'uA');
    const bravo = await api.connect();
    await api.admit(alpha, bravo, room, 'uB');
    expect(await ask(alpha, 'block-user', { roomCode: room, targetId: bravo.id })).toEqual({ ok: true });
    alpha.disconnect();
    await sleep(400); // emptied, then swept once the grace has passed
    return room;
  };
  const tryFound = (socket, room, uid, intent) =>
    new Promise((resolve) => {
      socket.once('access-granted', (p) => resolve(`granted:${p.role}`));
      socket.once('access-denied', () => resolve('denied'));
      socket.once('squad-code-taken', () => resolve('taken'));
      socket.once('join-refused', (p) => resolve(`refused:${p.reason}`));
      socket.emit('request-join', { roomCode: room, intent, user: { uid, name: uid } });
    });

  it('cannot be taken over by someone its Commander blocked', async () => {
    const room = await endedGroup();
    expect(await tryFound(await api.connect(), room, 'uB', 'create')).toBe('denied');
  });

  it('is free for anyone else, as before', async () => {
    const room = await endedGroup();
    expect(await tryFound(await api.connect(), room, 'uS', 'create')).toBe('granted:OWNER');
  });

  it('is its own Commander\'s to resume', async () => {
    const room = await endedGroup();
    expect(await tryFound(await api.connect(), room, 'uA', 'resume')).toBe('granted:OWNER');
  });
});

describe('the latency probe', () => {
  const api = e2eServer();

  it('echoes a number, and nothing else', async () => {
    const socket = await api.connect();
    const pongs = collect(socket, 'pong-bounce');
    socket.emit('check-ping', { not: 'a number' });
    socket.emit('check-ping', 'text');
    socket.emit('check-ping', 1234);
    await waitFor(() => pongs.length >= 1);
    await sleep(100);
    expect(pongs).toEqual([1234]);
  });
});

describe('a payload nested deeper than the app ever sends', () => {
  const api = e2eServer();

  it('is dropped, not relayed to the Group', async () => {
    const { room, alpha, bravo } = await api.squadOfThree();
    const routes = collect(alpha, 'new-custom-route');
    let deep = [12.8, 80.0];
    for (let i = 0; i < 20; i += 1) deep = [deep];
    bravo.emit('publish-custom-route', { roomCode: room, key: 'deep', data: deep });
    bravo.emit('publish-custom-route', { roomCode: room, key: 'flat', data: { distance: 'CUSTOM', eta: 'TACTICAL', path: [{ lat: 12.8, lng: 80.0 }, { lat: 12.81, lng: 80.01 }] } });
    await waitFor(() => routes.length >= 1);
    await settle(bravo);
    await settle(alpha);
    expect(routes.map((r) => r.key)).toEqual(['flat']);
  });
});

describe('a stand-in asking a join that goes nowhere under the Commander\'s uid', () => {
  const api = e2eServer();

  it('does not become the Commander for the Group\'s settings', async () => {
    const { room, alpha, charlie } = await api.squadOfThree();
    alpha.disconnect();
    charlie.disconnect();
    const standIn = await api.connect();
    expect(await api.requestJoin(standIn, room, 'uC')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    // Refused (no such Group), naming the Commander's uid, which every member is sent.
    standIn.emit('request-join', { roomCode: 'NOSUCH9', intent: 'join', user: { uid: 'uA', name: 'A' } });
    await settle(standIn);
    expect(await ask(standIn, 'set-group-settings', { roomCode: room, sosEnabled: false })).toEqual({ ok: false, reason: 'not-commander' });
  });
});
