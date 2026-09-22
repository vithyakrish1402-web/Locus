import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, once, settle } from './helpers/e2eServer.js';

/**
 * The Commander's telemetry sync ('request-telemetry'), end to end: the real server,
 * real sockets.
 *
 * The server only ever answered the one case it served: the squad exists and the asker
 * is its Commander. Anything else (a squad the server no longer has, a socket it doesn't
 * have down as Commander) got no reply at all, and the SYNC_TELEMETRY button had no
 * timeout either, so to the person tapping it, it did nothing. It now answers a client
 * that passes an acknowledgement, either way, with the reason when it refuses.
 *
 * And when it did answer, it sent its raw location cache. A member whose only fix so far
 * came from a GPS report ('update-location' writes lat/lng) and not yet from the
 * heartbeat ('safety-ping' writes latitude/longitude) had no `latitude`, and the
 * matrix's `latitude.toFixed()` took the whole app down. Each record is now normalised.
 */

const { connect, squadOfThree, newRoom, serverIsAlive } = e2eServer();

const syncWithAck = (socket, room) => socket.timeout(2000).emitWithAck('request-telemetry', room);

// A sync the way every installed build asks for one: no acknowledgement, just the data.
const sync = async (socket, room) => {
  const telemetry = once(socket, 'telemetry-sync-complete');
  socket.emit('request-telemetry', room);
  return telemetry;
};

const report = (socket, room, fix = {}) =>
  socket.emit('update-location', { name: 'Bravo', lat: 12.8235, lng: 80.0446, speed: 0, battery: 90, heading: 0, roomCode: room, ...fix });

describe('a telemetry sync', () => {
  it("answers the Commander with the squad's telemetry, and acknowledges it", async () => {
    const { room, alpha } = await squadOfThree();
    const telemetry = once(alpha, 'telemetry-sync-complete');
    expect(await syncWithAck(alpha, room)).toEqual({ ok: true });
    expect(await telemetry).toEqual({});
  });

  it('refuses a member who is not the Commander, and says why', async () => {
    const { room, bravo } = await squadOfThree();
    let gotTelemetry = false;
    bravo.on('telemetry-sync-complete', () => { gotTelemetry = true; });
    expect(await syncWithAck(bravo, room)).toEqual({ ok: false, reason: 'not-owner' });
    expect(gotTelemetry).toBe(false);
  });

  it('refuses a squad the server has no record of this socket in, and says why', async () => {
    const lone = await connect();
    expect(await syncWithAck(lone, newRoom())).toEqual({ ok: false, reason: 'not-in-squad' });
  });

  it('still answers a client that passes no acknowledgement (every build already installed)', async () => {
    const { room, alpha } = await squadOfThree();
    const telemetry = once(alpha, 'telemetry-sync-complete');
    alpha.emit('request-telemetry', room);
    expect(await telemetry).toEqual({});
  });

  it('survives a malformed request', async () => {
    const { room, alpha } = await squadOfThree();
    for (const payload of [undefined, null, 42, {}, [room]]) {
      alpha.emit('request-telemetry', payload, 'not-a-function');
      alpha.emit('request-telemetry', payload);
    }
    await settle(alpha);
    expect(await sync(alpha, room)).toEqual({});
    expect(serverIsAlive()).toBe(true);
  });
});

describe('the telemetry a sync returns', () => {
  it('describes a member whose only fix so far is a GPS report', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    report(bravo, room);
    await settle(bravo);

    const record = (await sync(alpha, room))[bravo.id];
    expect(record).toEqual({
      latitude: 12.8235,
      longitude: 80.0446,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      batteryLevel: '90%',
    });
  });

  it('keeps what the heartbeat reported, when there is one', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    report(bravo, room);
    bravo.emit('safety-ping', { latitude: 12.9, longitude: 80.1, timestamp: '2026-09-22T10:00:00.000Z', batteryLevel: '41%' });
    await settle(bravo);

    expect((await sync(alpha, room))[bravo.id]).toEqual({
      latitude: 12.9, longitude: 80.1, timestamp: '2026-09-22T10:00:00.000Z', batteryLevel: '41%',
    });
  });

  it('leaves out a member whose coordinates are not numbers, rather than sending them on', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    report(bravo, room, { lat: 'north', lng: {} });
    await settle(bravo);
    await sleep(50);

    expect(await sync(alpha, room)).toEqual({});
  });
});
