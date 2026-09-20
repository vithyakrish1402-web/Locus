import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, settle } from './helpers/e2eServer.js';

/**
 * End-to-end SOS relay: the real backend/server.js in a child process, driven by
 * real Socket.IO clients through the real join / approval flow. Nothing is mocked,
 * so this covers routing, replay and acknowledgement exactly as a phone would hit them.
 */

const { connect, createSquad, admit, returnToSquad, squadOfThree, newRoom, serverIsAlive } = e2eServer();

const fireSos = (socket, room, extra = {}) =>
  socket.emit('sos-broadcast', { senderName: 'Bravo', lat: 12.8231, lng: 80.0442, roomCode: room, timestamp: Date.now(), ...extra });

describe('SOS routing', () => {
  it('reaches every other member, not the sender and not another squad', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const otherRoom = newRoom();
    const delta = await connect();
    await createSquad(delta, otherRoom, 'uD');

    // Bravo never sent update-location, i.e. has no GPS fix and no `users` entry —
    // the case where the old server silently dropped the beacon.
    fireSos(bravo, room);

    await waitFor(() => alpha.sos.length && charlie.sos.length);
    expect(alpha.sos[0]).toMatchObject({ senderName: 'Bravo', lat: 12.8231, lng: 80.0442, ageMs: 0 });
    expect(alpha.sos[0].id).toBeTruthy();
    expect(charlie.sos[0].id).toBe(alpha.sos[0].id);
    await sleep(250);
    expect(bravo.sos).toEqual([]);
    expect(delta.sos).toEqual([]);
  });

  it('delivers when the sender has no coordinates at all', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    fireSos(bravo, room, { lat: null, lng: null });
    await waitFor(() => alpha.sos.length);
    expect(alpha.sos[0]).toMatchObject({ lat: null, lng: null });
  });

  it('ignores a claimed roomCode the sender is not a member of', async () => {
    const { alpha, bravo } = await squadOfThree();
    const otherRoom = newRoom();
    const delta = await connect();
    await createSquad(delta, otherRoom, 'uD');

    fireSos(bravo, otherRoom); // Bravo is not in otherRoom
    await waitFor(() => alpha.sos.length); // ...so it goes to Bravo's own squad instead
    await sleep(250);
    expect(delta.sos).toEqual([]);
  });

  it('drops an SOS from a socket that is in no squad', async () => {
    const { room, alpha, charlie } = await squadOfThree();
    const stranger = await connect();
    fireSos(stranger, room);
    await sleep(300);
    expect(alpha.sos).toEqual([]);
    expect(charlie.sos).toEqual([]);
  });

  it('survives an empty sos-broadcast and keeps relaying afterwards', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    bravo.emit('sos-broadcast'); // no payload at all
    await sleep(150);
    expect(serverIsAlive()).toBe(true);
    alpha.sos.length = 0;
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.some((s) => s.senderName === 'Bravo'));
  });
});

describe('SOS replay for members who missed it', () => {
  it('catches up a member who was offline, and reports how old it is', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    charlie.disconnect();

    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length);
    await sleep(100);

    // Charlie comes back on a new socket (new socket id, same person). Already approved,
    // so no Commander involved.
    const charlie2 = await connect();
    await returnToSquad(charlie2, room, 'uC');

    await waitFor(() => charlie2.sos.length);
    expect(charlie2.sos[0].id).toBe(alpha.sos[0].id);
    expect(charlie2.sos[0].senderName).toBe('Bravo');
    expect(charlie2.sos[0].ageMs).toBeGreaterThanOrEqual(50);
  });

  it('catches up a member who is approved into the squad after it fired', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length);

    const newcomer = await connect();
    await admit(alpha, newcomer, room, 'uN');
    await waitFor(() => newcomer.sos.length);
    expect(newcomer.sos[0].senderName).toBe('Bravo');
  });

  it('does not replay to the sender, even after they reconnect', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length);

    bravo.emit('sos-sync');
    bravo.disconnect();
    const bravo2 = await connect();
    await returnToSquad(bravo2, room, 'uB');
    await sleep(300);
    expect(bravo.sos).toEqual([]);
    expect(bravo2.sos).toEqual([]);
  });

  it('replays nothing when there is nothing outstanding', async () => {
    const { alpha } = await squadOfThree();
    alpha.emit('sos-sync');
    await sleep(250);
    expect(alpha.sos).toEqual([]);
  });

  it('ignores a sync from a socket that is in no squad', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length);
    const stranger = await connect();
    stranger.emit('sos-sync');
    await sleep(250);
    expect(stranger.sos).toEqual([]);
  });
});

describe('SOS acknowledgement', () => {
  it('stops replaying once a member acknowledges — and that survives a reconnect', async () => {
    const { room, bravo, charlie } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => charlie.sos.length);

    charlie.emit('sos-ack', { id: charlie.sos[0].id });
    await settle(charlie); // the ack is processed before the next connection asks for a replay
    charlie.disconnect();

    const charlie2 = await connect();
    await returnToSquad(charlie2, room, 'uC');
    await sleep(300);
    expect(charlie2.sos).toEqual([]);
  });

  it('keeps replaying to members who have not acknowledged yet', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => alpha.sos.length && charlie.sos.length);

    // Charlie acknowledges; Alpha does not, then reconnects.
    charlie.emit('sos-ack', { id: charlie.sos[0].id });
    alpha.sos.length = 0;
    alpha.emit('sos-sync');
    await waitFor(() => alpha.sos.length);
    expect(alpha.sos[0].senderName).toBe('Bravo');
  });

  it('a re-triggered SOS is a new alert everyone still owes an acknowledgement for', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => charlie.sos.length);
    charlie.emit('sos-ack', { id: charlie.sos[0].id });

    fireSos(bravo, room);
    await waitFor(() => charlie.sos.length === 2);
    expect(charlie.sos[1].id).not.toBe(charlie.sos[0].id);

    charlie.sos.length = 0;
    charlie.emit('sos-sync');
    await waitFor(() => charlie.sos.length === 1);
    expect(alpha.sos).toHaveLength(2);
  });

  it('shrugs off acknowledgements from strangers and for made-up ids', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    fireSos(bravo, room);
    await waitFor(() => charlie.sos.length);
    const { id } = charlie.sos[0];

    const stranger = await connect();
    stranger.emit('sos-ack', { id }); // not in any squad
    charlie.emit('sos-ack', { id: 'not-a-real-id' });
    charlie.emit('sos-ack'); // no payload
    await sleep(150);
    expect(serverIsAlive()).toBe(true);

    // None of that acknowledged anything: Charlie still gets it on sync.
    charlie.sos.length = 0;
    charlie.emit('sos-sync');
    await waitFor(() => charlie.sos.length);
    expect(charlie.sos[0].id).toBe(id);
    expect(alpha.sos[0].id).toBe(id);
  });
});
