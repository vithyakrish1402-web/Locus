import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, once } from './helpers/e2eServer.js';

/**
 * The stale-squad sweep, end to end, on a server whose timings are shortened from
 * minutes to fractions of a second.
 *
 * The sweep deletes a squad after ROOM_TTL_MS without activity, and only a GPS report
 * ('update-location') counted as activity. A squad where nobody had a fix — indoors,
 * location denied, GPS timing out — was deleted with every member still connected. The
 * members' phones kept its code, so the next reconnect re-created a brand-new squad
 * under it (Commander: whoever reconnected first), and everyone else was routed into
 * that stranger squad's approval queue.
 *
 * Activity now includes the latency probe every joined client sends every 2 seconds,
 * with or without a fix.
 */

const TTL_MS = 600;
const SWEEP_MS = 100;

const { connect, createSquad, admit, requestJoin, newRoom } = e2eServer({
  env: { LOCUS_ROOM_TTL_MS: String(TTL_MS), LOCUS_SWEEP_INTERVAL_MS: String(SWEEP_MS) },
});

// What the app does while it's in a squad, fix or no fix: App.jsx's latency tracker
// sends 'check-ping' every 2 s. Faster here, to match the shortened TTL.
const keepAppOpen = (socket) => {
  const timer = setInterval(() => socket.emit('check-ping', Date.now()), SWEEP_MS);
  return () => clearInterval(timer);
};

describe('the stale-squad sweep', () => {
  it('keeps a squad whose members are connected but have no GPS fix', async () => {
    const room = newRoom();
    const [owner, member] = [await connect(), await connect()];
    await createSquad(owner, room, 'uO');
    await admit(owner, member, room, 'uM');
    const stop = [keepAppOpen(owner), keepAppOpen(member)];

    await sleep(TTL_MS * 3); // well past the TTL, without a single update-location

    // Still the same squad: a newcomer queues for its Commander, rather than founding a
    // new squad under the code.
    const newcomer = await connect();
    const knock = once(owner, 'access-request');
    expect(await requestJoin(newcomer, room, 'uN')).toEqual({ outcome: 'pending' });
    expect(await knock).toMatchObject({ roomCode: room });
    stop.forEach((fn) => fn());
  });

  it('still removes a squad nobody is connected to', async () => {
    const room = newRoom();
    const owner = await connect();
    await createSquad(owner, room, 'uO');
    owner.disconnect();

    await sleep(SWEEP_MS * 4);
    const later = await connect();
    expect(await requestJoin(later, room, 'uL')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
  });

  it('still removes a squad whose members have gone completely silent for the TTL', async () => {
    const room = newRoom();
    const owner = await connect(); // connected, but sends nothing at all
    await createSquad(owner, room, 'uO');

    await sleep(TTL_MS * 2);
    const later = await connect();
    expect(await requestJoin(later, room, 'uL')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
  });

  it('does not leave the removed squad\'s members listening to whoever takes the code next', async () => {
    // Deleting the squad left its sockets subscribed to the room, so a squad founded later
    // under the same code broadcast its rally points and SOS to the old squad's phones.
    const room = newRoom();
    const [owner, member] = [await connect(), await connect()];
    await createSquad(owner, room, 'uO');
    await admit(owner, member, room, 'uM');
    await sleep(TTL_MS * 2); // both silent: swept

    const newcomer = await connect();
    expect(await requestJoin(newcomer, room, 'uN')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
    const heard = [];
    member.onAny((event) => heard.push(event));
    newcomer.emit('publish-waypoint', { roomCode: room, waypoint: { lat: 1, lng: 2, name: 'RALLY POINT' } });
    newcomer.emit('sos-broadcast', { senderName: 'N', lat: 1, lng: 2, roomCode: room });
    await sleep(200);
    expect(heard).toEqual([]);
  });
});
