import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, settle } from './helpers/e2eServer.js';

/**
 * End-to-end squad-scoped relays: 'geofence-alert', 'publish-zone' and
 * 'publish-custom-route'. Each is fanned out to the room named in the payload.
 *
 * That room used to be taken on the sender's word: a socket in no squad, or in a
 * different one, could put breach alarms, tactical zones and routes on the screens of
 * any squad whose code it knew. Now the sender has to be on that squad's roster —
 * the same check 'publish-waypoint' and 'vote-to-kick' make.
 */

const { connect, createSquad, squadOfThree, newRoom } = e2eServer();

const RELAYS = [
  {
    event: 'geofence-alert',
    received: 'geofence-alert',
    payload: (roomCode) => ({ roomCode, userName: 'Bravo', type: 'ENTER', zoneName: 'Tech Park' }),
  },
  {
    event: 'publish-zone',
    received: 'new-zone',
    payload: (roomCode) => ({ roomCode, zone: { id: 'z1', name: 'Rally Zone' } }),
  },
  {
    event: 'publish-custom-route',
    received: 'new-custom-route',
    payload: (roomCode) => ({ roomCode, key: 'A_B', data: [{ lat: 12.8, lng: 80.0 }] }),
  },
];

// Collect every `event` a socket receives.
const listen = (event, ...sockets) =>
  sockets.forEach((socket) => {
    socket.got = [];
    socket.on(event, (payload) => socket.got.push(payload));
  });

for (const { event, received, payload } of RELAYS) {
  describe(`'${event}'`, () => {
    it('reaches the rest of the sender\'s squad', async () => {
      const { room, alpha, bravo, charlie } = await squadOfThree();
      listen(received, alpha, bravo, charlie);

      bravo.emit(event, payload(room));

      await waitFor(() => alpha.got.length && charlie.got.length);
      await settle(bravo);
      await sleep(100);
      expect(bravo.got).toEqual([]);
    });

    it('is dropped when the sender is in no squad', async () => {
      const { room, alpha, bravo, charlie } = await squadOfThree();
      listen(received, alpha, bravo, charlie);
      const stranger = await connect();

      stranger.emit(event, payload(room));

      await settle(stranger);
      await sleep(200);
      expect([...alpha.got, ...bravo.got, ...charlie.got]).toEqual([]);
    });

    it('is dropped when aimed at a squad the sender is not in', async () => {
      const { room, alpha, bravo, charlie } = await squadOfThree();
      listen(received, alpha, bravo, charlie);
      const delta = await connect();
      await createSquad(delta, newRoom(), 'uD');

      delta.emit(event, payload(room));

      await settle(delta);
      await sleep(200);
      expect([...alpha.got, ...bravo.got, ...charlie.got]).toEqual([]);
    });

    it('cannot be aimed at a socket id to reach one member directly', async () => {
      const { alpha, bravo } = await squadOfThree();
      listen(received, bravo);
      const stranger = await connect();

      // Every socket is also a room of its own id.
      stranger.emit(event, payload(bravo.id));
      alpha.emit(event, payload(bravo.id));

      await settle(stranger);
      await settle(alpha);
      await sleep(200);
      expect(bravo.got).toEqual([]);
    });
  });
}
