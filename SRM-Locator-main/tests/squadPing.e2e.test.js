import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, settle } from './helpers/e2eServer.js';

/**
 * End-to-end member ping ('ping-user' -> 'receive-ping'): the real backend/server.js,
 * real Socket.IO clients, real join/approval flow.
 *
 * The server used to relay a ping to whatever `targetId` it was handed — any socket id
 * at all, or a room code, which io.to() happily treats as a room and broadcasts to. So
 * anyone connected could buzz any member of any squad, or a whole squad at once, with
 * a name of their choosing. A ping is now relayed only between members of one squad.
 */

const { connect, createSquad, squadOfThree, newRoom } = e2eServer();

// Collect every ping a socket receives.
const listen = (socket) => {
  socket.pings = [];
  socket.on('receive-ping', (payload) => socket.pings.push(payload));
  return socket;
};

const ping = (from, to, senderName = 'Pinger') =>
  from.emit('ping-user', { targetId: to.id ?? to, senderName });

describe('member ping', () => {
  it('reaches the targeted squadmate, and only them', async () => {
    const { alpha, bravo, charlie } = await squadOfThree();
    [alpha, bravo, charlie].forEach(listen);

    ping(alpha, bravo, 'Alpha');

    await waitFor(() => bravo.pings.length);
    expect(bravo.pings[0]).toEqual({ senderName: 'Alpha' });
    await settle(alpha);
    await sleep(150);
    expect(alpha.pings).toEqual([]);
    expect(charlie.pings).toEqual([]);
  });

  it('works from a regular member to the Commander too', async () => {
    const { alpha, charlie } = await squadOfThree();
    listen(alpha);
    ping(charlie, alpha, 'Charlie');
    await waitFor(() => alpha.pings.length);
    expect(alpha.pings[0]).toEqual({ senderName: 'Charlie' });
  });

  it('is dropped when the target is in a different squad', async () => {
    const { alpha } = await squadOfThree();
    const delta = listen(await connect());
    await createSquad(delta, newRoom(), 'uD');

    ping(alpha, delta);

    await settle(alpha);
    await sleep(200);
    expect(delta.pings).toEqual([]);
  });

  it('is dropped when the sender is in no squad at all', async () => {
    const { bravo } = await squadOfThree();
    listen(bravo);
    const stranger = await connect();

    ping(stranger, bravo, 'Totally Your Commander');

    await settle(stranger);
    await sleep(200);
    expect(bravo.pings).toEqual([]);
  });

  it('cannot be aimed at a room code to reach a whole squad', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    [alpha, bravo, charlie].forEach(listen);

    // From inside the squad, and from outside it.
    ping(bravo, room);
    const stranger = await connect();
    ping(stranger, room);

    await settle(bravo);
    await settle(stranger);
    await sleep(200);
    expect(alpha.pings).toEqual([]);
    expect(bravo.pings).toEqual([]);
    expect(charlie.pings).toEqual([]);
  });

  it('survives a ping with no payload', async () => {
    const { alpha, bravo } = await squadOfThree();
    listen(bravo);
    alpha.emit('ping-user');
    ping(alpha, bravo, 'Alpha');
    await waitFor(() => bravo.pings.length);
  });
});
