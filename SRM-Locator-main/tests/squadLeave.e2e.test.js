import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, once, settle } from './helpers/e2eServer.js';

/**
 * Leaving a squad, end to end: real server, real sockets.
 *
 * 'leave-squad' used to do nothing unless the server had a live position for the
 * member (`users` is only filled once a GPS fix arrives), so a member with no fix
 * could never leave. And even with a fix it never took the socket out of the squad's
 * room — and the app keeps the socket connected after leaving (or logging out) — so a
 * former member stayed subscribed to the squad's locations, SOS and Rally Points.
 */

const { connect, createSquad, requestJoin, squadOfThree, newRoom, serverIsAlive } = e2eServer();

const reportLocation = async (socket, room, name) => {
  socket.emit('update-location', { name, lat: 12.8, lng: 80.0, speed: 0, battery: 90, heading: 0, roomCode: room });
  await once(socket, 'users-update'); // the server has recorded a live position for them
};

const leave = async (socket) => {
  socket.emit('leave-squad');
  await settle(socket);
};

describe('a member who leaves', () => {
  // The bug was specific to members with no GPS fix, but the room-detach half affected
  // everyone, so run the whole group both ways.
  describe.each([
    { label: 'with no GPS fix', hasFix: false },
    { label: 'with a GPS fix', hasFix: true },
  ])('$label', ({ hasFix }) => {
    const squadWhereBravoLeaves = async () => {
      const squad = await squadOfThree();
      if (hasFix) await reportLocation(squad.bravo, squad.room, 'Bravo');
      await leave(squad.bravo);
      return squad;
    };

    it('must be approved again to come back', async () => {
      const { room, alpha, bravo } = await squadOfThree();
      const knocks = [];
      alpha.on('access-request', (req) => knocks.push(req));
      if (hasFix) await reportLocation(bravo, room, 'Bravo');
      await leave(bravo);
      bravo.disconnect();

      const bravo2 = await connect();
      expect(await requestJoin(bravo2, room, 'uB')).toEqual({ outcome: 'pending' });
      await waitFor(() => knocks.length);
    });

    it('stops receiving the squad\'s traffic, even though the app keeps the socket open', async () => {
      const { room, alpha, bravo, charlie } = await squadWhereBravoLeaves();

      charlie.emit('sos-broadcast', { senderName: 'Charlie', lat: 1, lng: 2, roomCode: room });
      await waitFor(() => alpha.sos.length);
      await sleep(250);
      expect(bravo.sos).toEqual([]);
    });

    it('can no longer raise an SOS into the squad', async () => {
      const { room, alpha, charlie, bravo } = await squadWhereBravoLeaves();

      bravo.emit('sos-broadcast', { senderName: 'Bravo', lat: 1, lng: 2, roomCode: room });
      await sleep(300);
      expect(alpha.sos).toEqual([]);
      expect(charlie.sos).toEqual([]);
    });

    it('leaves the rest of the squad working normally', async () => {
      const { room, alpha, charlie } = await squadWhereBravoLeaves();

      charlie.emit('sos-broadcast', { senderName: 'Charlie', lat: 1, lng: 2, roomCode: room });
      await waitFor(() => alpha.sos.length);
      alpha.emit('sos-broadcast', { senderName: 'Alpha', lat: 3, lng: 4, roomCode: room });
      await waitFor(() => charlie.sos.length);
    });

    it('is safe to do twice', async () => {
      const { bravo } = await squadWhereBravoLeaves();
      await leave(bravo);
      expect(serverIsAlive()).toBe(true);
    });
  });

  it('disappears from the roster everyone else sees', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    let roster = {};
    alpha.on('users-update', (users) => { roster = users; });
    await reportLocation(bravo, room, 'Bravo');
    await waitFor(() => Object.values(roster).some((u) => u.name === 'Bravo'));

    await leave(bravo);
    await waitFor(() => !Object.values(roster).some((u) => u.name === 'Bravo'));
  });
});

describe('a Commander who leaves', () => {
  it.each([
    { label: 'with no GPS fix', hasFix: false },
    { label: 'with a GPS fix', hasFix: true },
  ])('hands the squad on to the next member, $label', async ({ hasFix }) => {
    const { room, alpha, bravo } = await squadOfThree();
    if (hasFix) await reportLocation(alpha, room, 'Alpha');

    const promoted = once(bravo, 'promoted-to-owner');
    alpha.emit('leave-squad');
    expect(await promoted).toEqual({ roomCode: room });
  });

  it('closes the squad when they were the last member, so the room can be started afresh', async () => {
    const room = newRoom();
    const alpha = await connect();
    await createSquad(alpha, room, 'uA'); // sole member, no GPS fix
    await leave(alpha);

    // If the squad were still around, a newcomer would have to be approved by Alpha.
    const newcomer = await connect();
    expect(await requestJoin(newcomer, room, 'uN')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
  });
});

describe('a member removed by the squad, whose app then calls leave-squad', () => {
  it('is taken out of the room too, not just off the roster', async () => {
    // The app answers 'exiled' by leaving the squad. The server has already dropped them
    // from the roster by then, so leaving has to work off the socket's rooms, not the roster.
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const exiled = once(bravo, 'exiled');
    alpha.emit('vote-to-kick', { targetId: bravo.id, roomCode: room });
    charlie.emit('vote-to-kick', { targetId: bravo.id, roomCode: room });
    await exiled;
    await leave(bravo);

    charlie.emit('sos-broadcast', { senderName: 'Charlie', lat: 1, lng: 2, roomCode: room });
    await waitFor(() => alpha.sos.length);
    await sleep(250);
    expect(bravo.sos).toEqual([]);
  });
});

describe('leave-squad from a socket that is in no squad', () => {
  it('is harmless', async () => {
    const stranger = await connect();
    await leave(stranger);
    expect(serverIsAlive()).toBe(true);
  });
});
