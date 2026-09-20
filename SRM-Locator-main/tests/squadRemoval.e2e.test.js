import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, once, settle } from './helpers/e2eServer.js';

/**
 * Removing a member from a squad (mutiny vote or Commander block), end to end.
 *
 * Both used to take the member off the roster but leave their socket subscribed to the
 * squad's room. The app answers 'exiled' by leaving, so an honest client dropped out —
 * but that made the server's guarantee depend on the removed client cooperating. A
 * modified client could ignore the notice and keep receiving the squad's locations, SOS
 * alerts and Rally Points. The server now detaches the socket itself.
 */

const { connect, requestJoin, squadOfThree } = e2eServer();

const votedOut = async ({ room, alpha, bravo, charlie }) => {
  const exiled = once(bravo, 'exiled');
  alpha.emit('vote-to-kick', { targetId: bravo.id, roomCode: room });
  charlie.emit('vote-to-kick', { targetId: bravo.id, roomCode: room });
  return exiled;
};

const blocked = async ({ room, alpha, bravo }) => {
  const exiled = once(bravo, 'exiled');
  alpha.emit('block-user', { roomCode: room, targetId: bravo.id });
  return exiled;
};

const reportLocation = async (socket, room, name) => {
  socket.emit('update-location', { name, lat: 12.8, lng: 80.0, speed: 0, battery: 90, heading: 0, roomCode: room });
  await once(socket, 'users-update');
};

const sosFrom = (socket, room, name) =>
  socket.emit('sos-broadcast', { senderName: name, lat: 1, lng: 2, roomCode: room });

describe.each([
  { label: 'voted out by the squad', remove: votedOut, notice: undefined },
  { label: 'blocked by the Commander', remove: blocked, notice: { reason: 'blocked' } },
])('a member $label', ({ remove, notice }) => {
  it('is still told, so their app can react', async () => {
    const squad = await squadOfThree();
    const payload = await remove(squad);
    if (notice) expect(payload).toEqual(notice);
  });

  it('is taken out of the room by the server itself, even if their app ignores the notice', async () => {
    const squad = await squadOfThree();
    const { room, alpha, bravo, charlie } = squad;
    await remove(squad); // and Bravo's client does nothing about it — no leave-squad

    sosFrom(charlie, room, 'Charlie');
    await waitFor(() => alpha.sos.length);
    await sleep(250);
    expect(bravo.sos).toEqual([]);
  });

  it('also stops receiving live positions and roster updates', async () => {
    const squad = await squadOfThree();
    const { room, alpha, bravo } = squad;
    await reportLocation(alpha, room, 'Alpha');
    await remove(squad);

    let bravoSawRoster = false;
    bravo.on('users-update', () => { bravoSawRoster = true; });
    let alphaRoster = {};
    alpha.on('users-update', (users) => { alphaRoster = users; });

    // Alpha moves. Once Alpha has seen the broadcast for it, Bravo would have too if he
    // were still subscribed.
    alpha.emit('update-location', { name: 'Alpha', lat: 12.9, lng: 80.1, speed: 0, battery: 90, heading: 0, roomCode: room });
    await waitFor(() => Object.values(alphaRoster).some((u) => u.lat === 12.9));
    await sleep(200);
    expect(bravoSawRoster).toBe(false);
  });

  it('can no longer send an SOS into the squad', async () => {
    const squad = await squadOfThree();
    const { room, alpha, bravo, charlie } = squad;
    await remove(squad);

    sosFrom(bravo, room, 'Bravo');
    await sleep(300);
    expect(alpha.sos).toEqual([]);
    expect(charlie.sos).toEqual([]);
  });

  it('leaves the rest of the squad working normally', async () => {
    const squad = await squadOfThree();
    const { room, alpha, charlie } = squad;
    await remove(squad);

    sosFrom(charlie, room, 'Charlie');
    await waitFor(() => alpha.sos.length);
    sosFrom(alpha, room, 'Alpha');
    await waitFor(() => charlie.sos.length);
  });

  it('is unaffected by their app then calling leave-squad, as it does on "exiled"', async () => {
    const squad = await squadOfThree();
    const { room, alpha, bravo, charlie } = squad;
    await remove(squad);
    bravo.emit('leave-squad');
    await settle(bravo);

    sosFrom(charlie, room, 'Charlie');
    await waitFor(() => alpha.sos.length);
    await sleep(250);
    expect(bravo.sos).toEqual([]);
  });
});

describe('coming back after being removed', () => {
  it('a member voted out may knock again and, once approved, is back in the room', async () => {
    // Detaching must not be permanent: the same socket has to be able to rejoin.
    const squad = await squadOfThree();
    const { room, alpha, bravo, charlie } = squad;
    const knocks = [];
    alpha.on('access-request', (req) => knocks.push(req));
    await votedOut(squad);

    expect(await requestJoin(bravo, room, 'uB')).toEqual({ outcome: 'pending' });
    await waitFor(() => knocks.length);
    const granted = once(bravo, 'access-granted');
    alpha.emit('resolve-access', { targetId: knocks[0].targetId, roomCode: room, approved: true });
    expect(await granted).toMatchObject({ role: 'MEMBER', roomCode: room });

    sosFrom(charlie, room, 'Charlie');
    await waitFor(() => bravo.sos.length);
    expect(bravo.sos[0].senderName).toBe('Charlie');
  });

  it('a blocked member is refused when they knock again, and stays out of the room', async () => {
    const squad = await squadOfThree();
    const { room, alpha, bravo, charlie } = squad;
    await blocked(squad);

    expect(await requestJoin(bravo, room, 'uB')).toEqual({ outcome: 'denied' });

    sosFrom(charlie, room, 'Charlie');
    await waitFor(() => alpha.sos.length);
    await sleep(250);
    expect(bravo.sos).toEqual([]);
  });

  it('a blocked member cannot get back in on a fresh connection either', async () => {
    const squad = await squadOfThree();
    const { room, bravo } = squad;
    await blocked(squad);
    bravo.disconnect();

    const bravo2 = await connect();
    expect(await requestJoin(bravo2, room, 'uB')).toEqual({ outcome: 'denied' });
  });
});
