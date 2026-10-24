import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, settle } from './helpers/e2eServer.js';

// Trusted friends end to end (backend/friends.js): an SOS reaches the sender's trusted friends,
// the Group Lead and moderators, and nobody else, live, on catch-up and on the closed-app poll's
// shared rule (pendingSosFor). LOCUS_TEST_FRIENDS stands in for Firestore here: Bravo (uB) and
// Charlie (uC) are friends; Delta (uD) has none.
const api = e2eServer({ env: { LOCUS_TEST_FRIENDS: JSON.stringify({ uB: ['uC'], uC: ['uB'] }), LOCUS_SOS_COOLDOWN_DEFAULT_MS: '0', LOCUS_SOS_COALESCE_SEC: '0' } });

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const sos = (from, room) => from.emit('sos-broadcast', { senderName: 'x', lat: 12.82, lng: 80.04, roomCode: room, timestamp: Date.now() });

// Alpha (uA) leads; Bravo, Charlie, Delta are members.
const group = async () => {
  const { room, alpha, bravo, charlie } = await api.squadOfThree();
  const delta = await api.connect();
  await api.admit(alpha, delta, room, 'uD');
  await Promise.all([alpha, bravo, charlie, delta].map(settle));
  return { room, alpha, bravo, charlie, delta };
};

describe('an SOS', () => {
  it("reaches the sender's trusted friends and the Group Lead, and nobody else", async () => {
    const { room, alpha, bravo, charlie, delta } = await group();
    sos(bravo, room);
    await waitFor(() => alpha.sos.length && charlie.sos.length);
    await sleep(150);
    expect(delta.sos).toEqual([]);
    // Nor on a catch-up.
    delta.emit('sos-sync');
    await settle(delta);
    expect(delta.sos).toEqual([]);
  });

  it('reaches moderators too', async () => {
    const { room, alpha, bravo, delta } = await group();
    expect(await ask(alpha, 'set-moderator', { roomCode: room, targetId: delta.id, moderator: true })).toEqual({ ok: true });
    sos(bravo, room);
    await waitFor(() => delta.sos.length);
  });

  it('from someone with no friends still reaches the Group Lead', async () => {
    const { room, alpha, bravo, charlie, delta } = await group();
    sos(delta, room);
    await waitFor(() => alpha.sos.length);
    await sleep(150);
    expect(bravo.sos).toEqual([]);
    expect(charlie.sos).toEqual([]);
  });

  it("from the Group Lead with no friends and no moderators goes to everyone: never to nobody", async () => {
    const { room, alpha, bravo, charlie, delta } = await group();
    sos(alpha, room);
    await waitFor(() => bravo.sos.length && charlie.sos.length && delta.sos.length);
  });

  it('still reaches its audience when they reconnect and catch up', async () => {
    const { room, alpha, bravo, charlie } = await group();
    charlie.disconnect();
    sos(bravo, room);
    await waitFor(() => alpha.sos.length);
    const charlie2 = await api.connect();
    const back = await api.returnToSquad(charlie2, room, 'uC');
    expect(back.outcome).toBe('granted');
    await waitFor(() => charlie2.sos.length);
  });

  it('copes with a malformed friends-changed', async () => {
    const { room, bravo } = await group();
    for (const bad of [undefined, null, 7, 'x', { uid: 5 }, { uid: 'uB' }, { uid: 'uNobody' }]) bravo.emit('friends-changed', bad);
    await settle(bravo);
    expect(api.serverIsAlive()).toBe(true);
    // And SOS still works after it.
    sos(bravo, room);
    await settle(bravo);
  });
});
