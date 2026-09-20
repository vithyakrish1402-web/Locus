import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, once, settle } from './helpers/e2eServer.js';

/**
 * Reconnecting members, end to end: the real server, real sockets, the real join flow.
 *
 * A reconnect mints a new socket id. The server used to recognise members by socket id,
 * so every reconnect (a signal blip, a backgrounded app) sent an already-approved member
 * back into the Commander's approval queue — and, until approved, into the waiting room,
 * cut off from live alerts. They're now recognised by uid. These tests pin both halves:
 * who gets straight back in, and who still has to ask.
 */

const { connect, createSquad, requestJoin, squadOfThree, newRoom } = e2eServer();

// Count every knock on the Commander's door from here on.
const watchKnocks = (owner) => {
  const knocks = [];
  owner.on('access-request', (req) => knocks.push(req));
  return knocks;
};

describe('a previously approved member coming back skips re-approval', () => {
  it('is let straight back in as a MEMBER, without troubling the Commander', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    const knocks = watchKnocks(alpha);

    bravo.disconnect(); // signal drop
    const bravo2 = await connect(); // new socket id, same person
    const result = await requestJoin(bravo2, room, 'uB');

    expect(result).toEqual({ outcome: 'granted', role: 'MEMBER', roomCode: room });
    await sleep(250);
    expect(knocks).toEqual([]);
  });

  it('works when the server has not yet noticed the old connection died (half-open)', async () => {
    // Common on mobile: the phone reconnects while the server still thinks the old
    // socket is alive for up to a ping-timeout. Must not be mistaken for a stranger.
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const knocks = watchKnocks(alpha);

    const bravo2 = await connect(); // old `bravo` is still connected
    const result = await requestJoin(bravo2, room, 'uB');
    expect(result.outcome).toBe('granted');
    expect(knocks).toEqual([]);

    // The new connection now receives the squad's traffic; the superseded one doesn't.
    charlie.emit('sos-broadcast', { senderName: 'Charlie', lat: 1, lng: 2, roomCode: room });
    await waitFor(() => bravo2.sos.length);
    await sleep(250);
    expect(bravo.sos).toEqual([]);
  });

  it('gets the squad\'s current Rally Point again', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    alpha.emit('publish-waypoint', { roomCode: room, waypoint: { lat: 12.9, lng: 80.1 } });
    await once(bravo, 'new-waypoint');

    bravo.disconnect();
    const bravo2 = await connect();
    const waypoint = once(bravo2, 'new-waypoint');
    await requestJoin(bravo2, room, 'uB');
    expect(await waypoint).toEqual({ lat: 12.9, lng: 80.1 });
  });

  it('gets the live roster again', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    alpha.emit('update-location', { name: 'Alpha', lat: 12.8, lng: 80.0, speed: 0, battery: 90, heading: 0, roomCode: room });
    await once(bravo, 'users-update');

    bravo.disconnect();
    const bravo2 = await connect();
    const roster = once(bravo2, 'users-update');
    await requestJoin(bravo2, room, 'uB');
    const users = await roster;
    expect(Object.values(users).map((u) => u.name)).toContain('Alpha');
  });

  it('does not leave a duplicate of them on everyone else\'s map', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    let roster = {};
    alpha.on('users-update', (users) => { roster = users; });
    const namesOnMap = () => Object.values(roster).map((u) => u.name);
    const report = (socket) =>
      socket.emit('update-location', { name: 'Bravo', lat: 12.8, lng: 80.0, speed: 0, battery: 90, heading: 0, roomCode: room });

    report(bravo);
    await waitFor(() => namesOnMap().includes('Bravo'));

    // Back on a new connection while the old one lingers: the old marker must go...
    const bravo2 = await connect();
    await requestJoin(bravo2, room, 'uB');
    await waitFor(() => !namesOnMap().includes('Bravo'));

    // ...and once the new connection reports in, there's exactly one Bravo, not two.
    report(bravo2);
    await waitFor(() => namesOnMap().includes('Bravo'));
    expect(namesOnMap().filter((name) => name === 'Bravo')).toHaveLength(1);
  });

  it('does not raise a false "signal lost" when the superseded connection finally drops', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const signalLost = [];
    alpha.on('member-signal-lost', (e) => signalLost.push(e.name));

    const report = (socket, name) =>
      socket.emit('update-location', { name, lat: 12.8, lng: 80.0, speed: 0, battery: 90, heading: 0, roomCode: room });
    report(bravo, 'Bravo');
    report(charlie, 'Charlie');
    await sleep(150);

    // Bravo is back on a new connection while the old one lingers; Charlie just vanishes.
    const bravo2 = await connect();
    await requestJoin(bravo2, room, 'uB');
    bravo.disconnect();
    charlie.disconnect();

    await waitFor(() => signalLost.includes('Charlie')); // the detector works...
    await sleep(250);
    expect(signalLost).not.toContain('Bravo'); // ...and stays quiet for someone who's back
  });

  it('does not make the returning member a Commander', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    bravo.disconnect();
    const bravo2 = await connect();
    await requestJoin(bravo2, room, 'uB');

    // A newcomer knocks; Bravo tries to let them in. Only the real Commander can.
    const knocks = watchKnocks(alpha);
    const newcomer = await connect();
    const outcome = requestJoin(newcomer, room, 'uN');
    const { targetId } = await waitFor(() => knocks[0]);
    bravo2.emit('resolve-access', { targetId, roomCode: room, approved: true });

    const settled = await Promise.race([outcome, sleep(400).then(() => ({ outcome: 'still waiting' }))]);
    expect(settled).toEqual({ outcome: 'pending' });
  });
});

describe('everyone else still goes through the Commander', () => {
  it('a stranger must be approved', async () => {
    const { room, alpha } = await squadOfThree();
    const knocks = watchKnocks(alpha);

    const stranger = await connect();
    expect(await requestJoin(stranger, room, 'uStranger')).toEqual({ outcome: 'pending' });
    await waitFor(() => knocks.length);
    expect(knocks[0].roomCode).toBe(room);
  });

  it('someone with no identity at all must be approved (missing uid never matches a member)', async () => {
    const { room } = await squadOfThree();
    const anonymous = await connect();
    expect(await requestJoin(anonymous, room, null)).toEqual({ outcome: 'pending' });
  });

  it('being approved in one squad grants nothing in another', async () => {
    const { bravo } = await squadOfThree();
    const otherRoom = newRoom();
    const delta = await connect();
    await createSquad(delta, otherRoom, 'uD');

    bravo.disconnect();
    const bravo2 = await connect();
    expect(await requestJoin(bravo2, otherRoom, 'uB')).toEqual({ outcome: 'pending' });
  });

  it('a member who left on purpose must be approved again', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    const knocks = watchKnocks(alpha);

    // (Leaving with and without a GPS fix is covered in depth in squadLeave.e2e.test.js.)
    bravo.emit('leave-squad');
    await settle(bravo);
    bravo.disconnect();

    const bravo2 = await connect();
    expect(await requestJoin(bravo2, room, 'uB')).toEqual({ outcome: 'pending' });
    await waitFor(() => knocks.length);
  });

  it('a member voted out by the squad must be approved again', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const knocks = watchKnocks(alpha);

    const exiled = once(bravo, 'exiled');
    alpha.emit('vote-to-kick', { targetId: bravo.id, roomCode: room });
    charlie.emit('vote-to-kick', { targetId: bravo.id, roomCode: room });
    await exiled;
    bravo.disconnect();

    const bravo2 = await connect();
    expect(await requestJoin(bravo2, room, 'uB')).toEqual({ outcome: 'pending' }); // may knock; not blocked
    await waitFor(() => knocks.length);
  });

  it('a member the Commander blocked is refused outright', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    const exiled = once(bravo, 'exiled');
    alpha.emit('block-user', { roomCode: room, targetId: bravo.id });
    await exiled;
    bravo.disconnect();

    const bravo2 = await connect();
    expect(await requestJoin(bravo2, room, 'uB')).toEqual({ outcome: 'denied' });
  });
});

describe('a member who had been promoted to Commander', () => {
  it('comes back as the Commander, and new joiners ask them', async () => {
    const { room, alpha, bravo } = await squadOfThree();

    // Alpha leaves, so succession promotes Bravo (next in the roster).
    alpha.emit('update-location', { name: 'Alpha', lat: 12.8, lng: 80.0, speed: 0, battery: 90, heading: 0, roomCode: room });
    await once(alpha, 'users-update');
    const promoted = once(bravo, 'promoted-to-owner');
    alpha.emit('leave-squad');
    await promoted;

    // Bravo reconnects while the old connection still lingers.
    const bravo2 = await connect();
    expect(await requestJoin(bravo2, room, 'uB')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });

    // A newcomer's request now reaches Bravo's new connection.
    const knocks = [];
    bravo2.on('access-request', (req) => knocks.push(req));
    const newcomer = await connect();
    await requestJoin(newcomer, room, 'uN');
    await waitFor(() => knocks.length);
  });
});
