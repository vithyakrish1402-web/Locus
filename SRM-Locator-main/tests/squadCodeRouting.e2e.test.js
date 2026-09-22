import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, once, settle } from './helpers/e2eServer.js';

/**
 * A squad code reaching the squad it names, end to end: the real server, real sockets.
 *
 * INITIALIZE and CONNECT both sent the same 'request-join', and the server answered
 * it as "create the squad if it's missing, otherwise join it". So a code could land in
 * the wrong squad without ever colliding:
 *
 *  - a JOIN for a code with no live squad (the creator hadn't tapped INITIALIZE yet —
 *    the lobby shows the code for sharing before the squad exists — or the server had
 *    restarted, or swept the squad) silently made the joiner Commander of a new, empty
 *    squad, and the real creator then queued for the joiner's approval;
 *  - a CREATE for a code that was already live queued the creator for a stranger's
 *    approval, or, if that squad's Commander was briefly offline, made the creator its
 *    Commander;
 *  - an approval for a request the joiner had abandoned (ABORT HANDSHAKE never told the
 *    server) pulled them into that squad even after they'd moved on to another one.
 *
 * Requests now say which they are. With no intent (every client already installed) the
 * old create-or-join behaviour is kept, so those clients can still make squads.
 */

const { connect, createSquad, admit, requestJoin, squadOfThree, newRoom } = e2eServer();

// Sends a join request with an intent and reports what the server decided.
const ask = (socket, room, uid, intent) =>
  new Promise((resolve) => {
    const outcomes = {
      'access-granted': 'granted',
      'access-pending': 'pending',
      'access-denied': 'denied',
      'squad-not-found': 'not-found',
      'squad-code-taken': 'code-taken',
    };
    const listeners = Object.entries(outcomes).map(([event, outcome]) => {
      const listener = (payload) => {
        listeners.forEach(([e, l]) => socket.off(e, l));
        resolve({ outcome, ...(payload ?? {}) });
      };
      socket.on(event, listener);
      return [event, listener];
    });
    socket.emit('request-join', { roomCode: room, user: { uid, name: uid }, intent });
  });

// Every knock on the Commander's door, and every one taken back, from here on.
const watchDoor = (owner) => {
  const door = { knocks: [], withdrawn: [] };
  owner.on('access-request', (req) => door.knocks.push(req));
  owner.on('access-request-withdrawn', (w) => door.withdrawn.push(w));
  return door;
};

// Everything a socket hears from here on, by event name.
const record = (socket) => {
  const heard = [];
  socket.onAny((event, payload) => heard.push({ event, payload }));
  return heard;
};

describe('joining with a code no live squad has', () => {
  it('is refused, instead of making the joiner Commander of a new empty squad', async () => {
    const room = newRoom();
    const joiner = await connect();
    expect(await ask(joiner, room, 'uJ', 'join')).toEqual({ outcome: 'not-found', roomCode: room });
  });

  it('is refused when everyone in the squad has just dropped off, instead of handing it to the joiner', async () => {
    // Until the sweep gets to it (up to a minute), a squad whose members have all gone is
    // still on file, and a JOIN used to reach the caretaker case: Commander of nobody.
    const room = newRoom();
    const [owner, joiner] = [await connect(), await connect()];
    await ask(owner, room, 'uO', 'create');
    owner.disconnect();
    await sleep(100);

    expect(await ask(joiner, room, 'uJ', 'join')).toEqual({ outcome: 'not-found', roomCode: room });
    // Its Commander can still come back to it.
    const owner2 = await connect();
    expect(await ask(owner2, room, 'uO', 'resume')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
  });

  it('leaves the code free for its creator, who gets the squad and the joiner\'s request', async () => {
    // The race the lobby invites: the code is on screen, with "share this code", before
    // INITIALIZE is tapped.
    const room = newRoom();
    const [joiner, creator] = [await connect(), await connect()];
    await ask(joiner, room, 'uJ', 'join');

    expect(await ask(creator, room, 'uC', 'create')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });

    const door = watchDoor(creator);
    expect(await ask(joiner, room, 'uJ', 'join')).toEqual({ outcome: 'pending', roomCode: room });
    await waitFor(() => door.knocks.length);
    expect(door.knocks[0]).toMatchObject({ targetId: joiner.id, roomCode: room });
  });
});

describe('creating a squad under a code that is already live', () => {
  it('is refused, and the squad already using it hears nothing', async () => {
    const room = newRoom();
    const owner = await connect();
    await ask(owner, room, 'uO', 'create');
    const door = watchDoor(owner);

    const creator = await connect();
    expect(await ask(creator, room, 'uC', 'create')).toEqual({ outcome: 'code-taken', roomCode: room });
    await settle(creator);
    await sleep(100);
    expect(door.knocks).toEqual([]);
  });

  it('does not hand over a squad whose Commander is momentarily offline', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    alpha.disconnect(); // backgrounded app / signal blip

    const creator = await connect();
    const bravoHears = record(bravo);
    expect(await ask(creator, room, 'uC', 'create')).toEqual({ outcome: 'code-taken', roomCode: room });

    // The squad is still Alpha's: back on a new connection, Alpha is its Commander.
    const alpha2 = await connect();
    expect(await requestJoin(alpha2, room, 'uA')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
    // And the would-be creator never showed up on the squad's roster.
    const rosters = bravoHears.filter((h) => h.event === 'users-update').map((h) => Object.values(h.payload));
    expect(rosters.flat().map((u) => u.uid)).not.toContain('uC');
  });

  it('lets the squad\'s own Commander re-send their create (a retry, or a duplicate after a reconnect)', async () => {
    const room = newRoom();
    const owner = await connect();
    await ask(owner, room, 'uO', 'create');

    const owner2 = await connect();
    expect(await ask(owner2, room, 'uO', 'create')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
  });
});

describe('an approval for a request that is no longer open', () => {
  it('does not pull in a joiner who aborted the handshake', async () => {
    const room = newRoom();
    const [commander, joiner] = [await connect(), await connect()];
    await createSquad(commander, room, 'uA');
    const door = watchDoor(commander);

    expect(await ask(joiner, room, 'uX', 'join')).toMatchObject({ outcome: 'pending' });
    await waitFor(() => door.knocks.length);

    joiner.emit('cancel-join', { roomCode: room });
    await settle(joiner);

    // A Commander still looking at the old request taps GRANT anyway.
    const joinerHears = record(joiner);
    commander.emit('resolve-access', { targetId: door.knocks[0].targetId, roomCode: room, approved: true });
    commander.emit('publish-waypoint', { roomCode: room, waypoint: { lat: 1, lng: 2, name: 'RALLY POINT' } });
    await settle(commander);
    await sleep(150);
    expect(joinerHears.map((h) => h.event)).not.toContain('access-granted');
    expect(joinerHears.map((h) => h.event)).not.toContain('new-waypoint');

    // And the Commander was told the request had been taken back.
    await waitFor(() => door.withdrawn.length);
    expect(door.withdrawn[0]).toEqual({ targetId: joiner.id, roomCode: room });
  });

  it('does not pull a joiner into a squad they abandoned for another one (clients that never send cancel-join)', async () => {
    const [roomA, roomB] = [newRoom(), newRoom()];
    const [commanderA, x] = [await connect(), await connect()];
    await createSquad(commanderA, roomA, 'uA');
    const door = watchDoor(commanderA);

    await requestJoin(x, roomA, 'uX'); // waiting on A
    await waitFor(() => door.knocks.length);
    expect(await requestJoin(x, roomB, 'uX')).toMatchObject({ outcome: 'granted', role: 'OWNER', roomCode: roomB });
    await settle(x); // anything else B's founding sends x arrives before listening starts

    const xHears = record(x);
    commanderA.emit('resolve-access', { targetId: door.knocks[0].targetId, roomCode: roomA, approved: true });
    commanderA.emit('publish-waypoint', { roomCode: roomA, waypoint: { lat: 1, lng: 2, name: 'A RALLY POINT' } });
    await settle(commanderA);
    await sleep(150);
    expect(xHears).toEqual([]);

    // Asking B took back the request on A, and A's Commander was told.
    await waitFor(() => door.withdrawn.length);
    expect(door.withdrawn[0]).toEqual({ targetId: x.id, roomCode: roomA });
  });

  it('cannot be approved into a different squad from the one it asked for', async () => {
    // The Commander's queue used to survive leaving, and GRANT answered for whatever squad
    // the Commander was in now. So: X asks for A, the Commander leaves A and founds B, taps
    // GRANT on X's old request, and X is let into B while their screen still says A.
    const [roomA, roomB] = [newRoom(), newRoom()];
    const [commander, x] = [await connect(), await connect()];
    await createSquad(commander, roomA, 'uC');
    const door = watchDoor(commander);
    await requestJoin(x, roomA, 'uX');
    await waitFor(() => door.knocks.length);

    commander.emit('leave-squad');
    await settle(commander);
    await createSquad(commander, roomB, 'uC');

    const xHears = record(x);
    commander.emit('resolve-access', { targetId: x.id, roomCode: roomB, approved: true });
    await settle(commander);
    await sleep(150);
    expect(xHears.map((h) => h.event)).not.toContain('access-granted');
  });

  it('does not bounce a joiner out of the squad they moved to with a stale denial', async () => {
    const [roomA, roomB] = [newRoom(), newRoom()];
    const [commanderA, x] = [await connect(), await connect()];
    await createSquad(commanderA, roomA, 'uA');
    const door = watchDoor(commanderA);
    await requestJoin(x, roomA, 'uX');
    await waitFor(() => door.knocks.length);
    await requestJoin(x, roomB, 'uX');

    const xHears = record(x);
    commanderA.emit('resolve-access', { targetId: door.knocks[0].targetId, roomCode: roomA, approved: false });
    await settle(commanderA);
    await sleep(150);
    expect(xHears.map((h) => h.event)).not.toContain('access-denied');
  });

  it('tells a Commander who acts on a request that is already gone, so it leaves their queue', async () => {
    const room = newRoom();
    const [commander, joiner] = [await connect(), await connect()];
    await createSquad(commander, room, 'uA');
    const door = watchDoor(commander);
    await requestJoin(joiner, room, 'uX');
    await waitFor(() => door.knocks.length);
    joiner.disconnect();
    await waitFor(() => door.withdrawn.length); // a pending joiner who drops off is withdrawn too

    door.withdrawn.length = 0;
    commander.emit('resolve-access', { targetId: door.knocks[0].targetId, roomCode: room, approved: true });
    await waitFor(() => door.withdrawn.length);
    expect(door.withdrawn[0]).toEqual({ targetId: door.knocks[0].targetId, roomCode: room });
  });

  it('keeps one request per person: asking again from a new connection replaces the old one', async () => {
    const room = newRoom();
    const commander = await connect();
    await createSquad(commander, room, 'uA');
    const door = watchDoor(commander);

    const x = await connect();
    await requestJoin(x, room, 'uX');
    await waitFor(() => door.knocks.length === 1);

    const x2 = await connect(); // same person, reconnected while waiting
    await requestJoin(x2, room, 'uX');
    await waitFor(() => door.knocks.length === 2 && door.withdrawn.length === 1);
    expect(door.withdrawn[0]).toEqual({ targetId: x.id, roomCode: room });

    const granted = once(x2, 'access-granted');
    commander.emit('resolve-access', { targetId: x2.id, roomCode: room, approved: true });
    expect(await granted).toEqual({ role: 'MEMBER', roomCode: room });
  });

  it('names the squad in every reply, so a client can tell which squad it is about', async () => {
    const room = newRoom();
    const [commander, joiner] = [await connect(), await connect()];
    await createSquad(commander, room, 'uA');
    const door = watchDoor(commander);

    expect(await ask(joiner, room, 'uX', 'join')).toEqual({ outcome: 'pending', roomCode: room });
    await waitFor(() => door.knocks.length);
    const denied = once(joiner, 'access-denied');
    commander.emit('resolve-access', { targetId: joiner.id, roomCode: room, approved: false });
    expect(await denied).toEqual({ roomCode: room });
  });
});

describe('a Commander who takes over a squad with requests waiting', () => {
  it('is handed the queue: after a reconnect, after a promotion', async () => {
    const room = newRoom();
    const [alpha, bravo, joiner] = [await connect(), await connect(), await connect()];
    await createSquad(alpha, room, 'uA');
    await admit(alpha, bravo, room, 'uB');
    await requestJoin(joiner, room, 'uX'); // waiting

    // The Commander's app restarts: a new connection, and the old queue is gone from it.
    alpha.disconnect();
    const alpha2 = await connect();
    const requeued = once(alpha2, 'access-request');
    await requestJoin(alpha2, room, 'uA');
    expect(await requeued).toMatchObject({ targetId: joiner.id, roomCode: room });

    // The Commander leaves: the member promoted in their place gets the queue.
    const handedOver = once(bravo, 'access-request');
    alpha2.emit('leave-squad');
    expect(await handedOver).toMatchObject({ targetId: joiner.id, roomCode: room });
  });
});

describe('after a Commander leaves', () => {
  it('coming back does not take the squad from the member promoted in their place', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    const promoted = once(bravo, 'promoted-to-owner');
    alpha.emit('leave-squad');
    await promoted;

    const door = watchDoor(bravo);
    expect(await requestJoin(alpha, room, 'uA')).toEqual({ outcome: 'pending' });

    // Bravo is still the one who decides.
    await waitFor(() => door.knocks.length);
    const granted = once(alpha, 'access-granted');
    bravo.emit('resolve-access', { targetId: alpha.id, roomCode: room, approved: true });
    expect(await granted).toEqual({ role: 'MEMBER', roomCode: room });
  });
});

describe('a squad that is gone', () => {
  it('tells whoever is still waiting on it', async () => {
    const room = newRoom();
    const [commander, joiner] = [await connect(), await connect()];
    await createSquad(commander, room, 'uA');
    const door = watchDoor(commander);
    await requestJoin(joiner, room, 'uX');
    await waitFor(() => door.knocks.length);

    const gone = once(joiner, 'squad-not-found');
    commander.emit('leave-squad'); // the only member: the squad goes with them
    expect(await gone).toEqual({ roomCode: room });
  });

  it('is re-created when its Commander resumes it (a server restart wipes every squad)', async () => {
    const room = newRoom();
    const owner = await connect();
    expect(await ask(owner, room, 'uO', 'resume')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
  });
});

describe('clients that send no intent (every build already installed)', () => {
  it('still create a squad under a free code, and still join a live one', async () => {
    const room = newRoom();
    const [first, second] = [await connect(), await connect()];
    expect(await requestJoin(first, room, 'u1')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
    expect(await requestJoin(second, room, 'u2')).toEqual({ outcome: 'pending' });
  });
});
