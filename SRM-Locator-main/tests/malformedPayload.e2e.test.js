import { describe, it, expect } from 'vitest';
import { e2eServer, sleep } from './helpers/e2eServer.js';

/**
 * End-to-end: no single message, however malformed, may take the server down.
 *
 * Socket.IO runs event handlers synchronously, so a handler that throws — say, by
 * destructuring a payload that isn't there — is an uncaught exception, and the whole
 * process exits. Every squad on the server goes with it, and all of it is in memory,
 * so none of it comes back. Anyone connected could do that with one emit.
 *
 * Each case gets a server of its own, so one crash can't mask whether another handler
 * would have survived.
 */

// Fire `send` at a live three-person squad, then check the server is still up and
// still doing its job.
const survives = (name, send) =>
  describe(name, () => {
    const { connect, createSquad, squadOfThree, newRoom, serverIsAlive } = e2eServer();

    it('does not take the server down', async () => {
      const squad = await squadOfThree();
      const stranger = await connect();
      send({ ...squad, stranger });

      await sleep(200);
      expect(serverIsAlive()).toBe(true);
      // And it still serves: a new squad can be created.
      await createSquad(await connect(), newRoom(), 'uZ');
    });
  });

// Handlers that take a payload. A bare emit reaches the handler as `undefined`, and a
// client can just as easily send `null` — a `= {}` default only covers the first.
const PAYLOAD_EVENTS = [
  'geofence-alert',
  'publish-zone',
  'vote-to-kick',
  'safety-ping',
  'request-telemetry',
  'request-join',
  'resolve-access',
  'block-user',
  'publish-custom-route',
  'publish-waypoint',
  'clear-waypoint',
  'update-location',
  'ping-user',
  'sos-broadcast',
  'sos-ack',
];

describe('a missing payload', () => {
  for (const event of PAYLOAD_EVENTS) {
    survives(`'${event}' with no payload, or null`, ({ bravo, stranger }) => {
      bravo.emit(event);
      bravo.emit(event, null);
      stranger.emit(event);
      stranger.emit(event, null);
    });
  }
});

describe('a payload missing a nested field', () => {
  // A stranger knocking on a live squad reaches the "ask the Commander" path, which
  // read user.name straight off the payload.
  survives("'request-join' with no user", ({ room, stranger }) => {
    stranger.emit('request-join', { roomCode: room });
  });

  survives("'request-join' with a null user", ({ room, stranger }) => {
    stranger.emit('request-join', { roomCode: room, user: null });
  });

  // A member's rally point with nothing to rally to.
  survives("'publish-waypoint' with no waypoint", ({ room, bravo }) => {
    bravo.emit('publish-waypoint', { roomCode: room });
  });
});

// A room code is looked up as a key on a plain object, and a plain object already has
// keys: activeSquads['constructor'] is Object, activeSquads['__proto__'] is
// Object.prototype. Both are truthy "squads" with no members list.
describe('a room code that names a built-in object key', () => {
  for (const roomCode of ['__proto__', 'constructor', 'toString']) {
    survives(`'${roomCode}' as a room code`, ({ bravo, stranger }) => {
      stranger.emit('request-join', { roomCode, user: { uid: 'uX', name: 'X' } });
      for (const socket of [bravo, stranger]) {
        socket.emit('update-location', { roomCode, lat: 12.8, lng: 80.0 });
        socket.emit('vote-to-kick', { roomCode, targetId: bravo.id });
        socket.emit('publish-waypoint', { roomCode, waypoint: { lat: 12.8, lng: 80.0 } });
        socket.emit('resolve-access', { roomCode, targetId: bravo.id, approved: true });
        socket.emit('block-user', { roomCode, targetId: bravo.id });
        socket.emit('clear-waypoint', roomCode);
        socket.emit('request-telemetry', roomCode);
        socket.emit('geofence-alert', { roomCode, userName: 'X', zoneName: 'Z' });
        socket.emit('publish-zone', { roomCode, zone: {} });
        socket.emit('publish-custom-route', { roomCode, key: 'k', data: [] });
      }
    });
  }
});

// A value that cannot be turned into a string: JSON gives an object whose own toString is a
// number, so using it as a key or in a template literal throws. Any field a handler keys a
// lookup by, or logs, could carry one.
const NO_STRING = { toString: 1 };
describe('a field that cannot be turned into a string', () => {
  survives('as a room code, from a stranger', ({ stranger }) => {
    for (const event of ['geofence-alert', 'publish-zone', 'publish-custom-route', 'vote-to-kick', 'resolve-access',
      'admit-all', 'kick-member', 'block-user', 'get-blocked', 'unblock-user', 'set-moderator', 'get-activity-log',
      'publish-waypoint', 'update-location', 'set-group-settings', 'get-alert-log', 'sos-broadcast']) {
      stranger.emit(event, { roomCode: NO_STRING });
    }
    stranger.emit('request-telemetry', NO_STRING);
    stranger.emit('clear-waypoint', NO_STRING);
  });

  survives('as a ping target, from a stranger', ({ stranger }) => {
    stranger.emit('ping-user', { targetId: NO_STRING });
  });

  survives('as an SOS sender name, from a stranger and from a member', ({ room, bravo, stranger }) => {
    stranger.emit('sos-broadcast', { senderName: NO_STRING });
    bravo.emit('sos-broadcast', { roomCode: room, senderName: NO_STRING, clientId: 'x1' });
  });

  survives('as a battery level, read back by the Commander', ({ room, alpha }) => {
    alpha.emit('safety-ping', { latitude: 1, longitude: 1, batteryLevel: NO_STRING });
    alpha.emit('request-telemetry', room);
  });
});

// A frame under the size limit can still nest tens of thousands of levels deep, and echoing
// or relaying it walks it recursively. Written straight to the transport: the client's own
// encoder would choke on it first. ('2' is a Socket.IO event; Engine.IO adds its own '4'.)
const DEEP = '['.repeat(40_000) + ']'.repeat(40_000);
describe('a payload nested far deeper than any real one', () => {
  survives("'check-ping' from a stranger", ({ stranger }) => {
    stranger.io.engine.write(`2["check-ping",${DEEP}]`);
  });

  survives("'geofence-alert' from a member", ({ room, bravo }) => {
    bravo.io.engine.write(`2["geofence-alert",{"roomCode":"${room}","deep":${DEEP}}]`);
  });

  survives("'update-location' from a member", ({ room, bravo }) => {
    bravo.io.engine.write(`2["update-location",{"roomCode":"${room}","lat":12.8,"lng":80.0,"deep":${DEEP}}]`);
  });
});
