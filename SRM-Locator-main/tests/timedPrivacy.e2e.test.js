import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, settle, once } from './helpers/e2eServer.js';

// Timed Pause and Hidden end to end (backend/sharingHolds.js and server.js): the real server, real
// Socket.IO clients. A hold "minute" is 100 ms here (LOCUS_HOLD_MINUTE_MS), so the 30-minute limit
// is 3 s and the rolling hour 6 s. Bravo (uB) and Charlie (uC) are trusted friends; Delta (uD) is
// not anyone's.
const MINUTE = 100;
const on = e2eServer({
  env: {
    LOCUS_TIMED_PRIVACY_ENABLED: 'true',
    LOCUS_HOLD_MINUTE_MS: String(MINUTE),
    LOCUS_HOLD_SWEEP_MS: '20',
    LOCUS_TEST_FRIENDS: JSON.stringify({ uB: ['uC'], uC: ['uB'] }),
    LOCUS_SOS_COOLDOWN_DEFAULT_MS: '0',
    LOCUS_SOS_COALESCE_SEC: '0',
  },
});
// The same server with the switch left as it ships: off.
const off = e2eServer();

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const P1 = { lat: 12.8231, lng: 80.0442 };
const P2 = { lat: 12.8240, lng: 80.0450 };
const report = (socket, room, position, status = 'ACTIVE') =>
  socket.emit('update-location', { roomCode: room, ...position, status, speed: 0, heading: 0, battery: 80 });

// Keeps each socket's latest member list.
const watchRoster = (...sockets) => sockets.forEach((s) => {
  s.roster = {};
  s.on('users-update', (list) => { s.roster = list; });
});
const entryOf = (socket, uid) => Object.values(socket.roster ?? {}).find((e) => e.uid === uid);

// A Group of four on its own room. Holds and their allowance belong to the account, server-wide,
// so each test has accounts of its own (uB1, uB2, ...); the SOS test asks for the friends above.
let groupSeq = 0;
const group = async (api, { friends = false } = {}) => {
  const n = friends ? '' : String(++groupSeq);
  const uids = { a: `uA${n}`, b: `uB${n}`, c: `uC${n}`, d: `uD${n}` };
  const room = api.newRoom();
  const [alpha, bravo, charlie, delta] = [await api.connect(), await api.connect(), await api.connect(), await api.connect()];
  await api.createSquad(alpha, room, uids.a);
  await api.admit(alpha, bravo, room, uids.b);
  await api.admit(alpha, charlie, room, uids.c);
  await api.admit(alpha, delta, room, uids.d);
  watchRoster(alpha, bravo, charlie, delta);
  await Promise.all([alpha, bravo, charlie, delta].map(settle));
  return { room, alpha, bravo, charlie, delta, B: uids.b };
};
const logKinds = async (alpha, room, uid) =>
  (await ask(alpha, 'get-activity-log', { roomCode: room })).log.filter((e) => e.uid === uid).map((e) => e.kind);

describe('with timed Pause and Hidden switched off (as shipped)', () => {
  it('refuses set-sharing-mode and leaves Paused and Hidden as each phone reports them', async () => {
    const { room, alpha, bravo, B } = await group(off);
    expect(await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 5 })).toEqual({ ok: false, reason: 'disabled' });
    report(bravo, room, P1, 'FROZEN');
    await waitFor(() => entryOf(alpha, B)?.status === 'FROZEN');
    expect(entryOf(alpha, B)).toMatchObject({ lat: P1.lat, lng: P1.lng, hasFix: true });
    expect(entryOf(alpha, B).holdUntil).toBeUndefined();
    report(bravo, room, P1, 'GHOST');
    await waitFor(() => entryOf(alpha, B)?.status === 'GHOST');
    expect(entryOf(alpha, B).lat).toBeUndefined();
    // Pause is not logged while the switch is off: the app has no words for it yet.
    expect(await logKinds(alpha, room, B)).toEqual(['went-hidden']);
  });

  it('sends no sharing-hold when someone is let in', async () => {
    const room = off.newRoom();
    const alpha = await off.connect();
    let heard = false;
    alpha.on('sharing-hold', () => { heard = true; });
    await off.createSquad(alpha, room, 'uA');
    await settle(alpha);
    expect(heard).toBe(false);
  });
});

describe('Hidden for a number of minutes', () => {
  it('shows the Group the end time and no position, whatever the phone sends, then ends by itself', async () => {
    const { room, alpha, bravo, B } = await group(on);
    report(bravo, room, P1);
    await waitFor(() => entryOf(alpha, B)?.hasFix);

    const before = Date.now();
    const reply = await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 5 });
    expect(reply).toMatchObject({ ok: true, mode: 'GHOST' });
    expect(reply.until).toBeGreaterThanOrEqual(before + 5 * MINUTE);
    expect(reply.until).toBeLessThanOrEqual(Date.now() + 5 * MINUTE);
    expect(reply.allowanceLeftMs).toBe(25 * MINUTE);

    await waitFor(() => entryOf(alpha, B)?.status === 'GHOST');
    expect(entryOf(alpha, B)).toMatchObject({ hasFix: false, holdUntil: reply.until });
    expect(entryOf(alpha, B).lat).toBeUndefined();

    // The phone saying Live and sending positions changes nothing while the hold runs.
    report(bravo, room, P2, 'ACTIVE');
    await settle(bravo);
    await sleep(30);
    expect(entryOf(alpha, B)).toMatchObject({ status: 'GHOST', hasFix: false });
    expect(entryOf(alpha, B).lat).toBeUndefined();

    // Time is up: the server ends it and tells the phone.
    const ended = await once(bravo, 'sharing-hold-ended');
    expect(Date.now()).toBeGreaterThanOrEqual(reply.until);
    expect(ended).toMatchObject({ reason: 'expired', endedMode: 'GHOST', mode: 'ACTIVE', until: null });
    await waitFor(() => entryOf(alpha, B)?.status === 'ACTIVE');
    expect(entryOf(alpha, B).holdUntil).toBeUndefined();
    // Live again from the next position.
    report(bravo, room, P2);
    await waitFor(() => entryOf(alpha, B)?.lat === P2.lat);
    expect(await logKinds(alpha, room, B)).toEqual(['went-hidden', 'back-from-hidden']);
  });

  it("keeps a Hidden member's position out of the Lead's table and out of a lost-signal notice", async () => {
    const { room, alpha, bravo, B } = await group(on);
    report(bravo, room, P1);
    await waitFor(() => entryOf(alpha, B)?.hasFix);
    expect((await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 20 })).ok).toBe(true);
    const tableOf = async () => {
      const table = once(alpha, 'telemetry-sync-complete');
      alpha.emit('request-telemetry', room, () => {});
      return table;
    };
    // Where they were before hiding is dropped the moment the hold starts...
    expect((await tableOf())[bravo.id]).toBeUndefined();
    // ... and the live positions the phone goes on sending are never kept.
    report(bravo, room, P2, 'ACTIVE');
    await settle(bravo);
    expect((await tableOf())[bravo.id]).toBeUndefined();

    let lost = null;
    alpha.on('member-signal-lost', (p) => { lost = p; });
    bravo.disconnect();
    await sleep(250);
    expect(lost).toBeNull();
  });
});

describe('Paused for a number of minutes', () => {
  it('holds the Group at the spot it was paused at, then ends by itself', async () => {
    const { room, alpha, bravo, B } = await group(on);
    report(bravo, room, P1);
    await waitFor(() => entryOf(alpha, B)?.lat === P1.lat);
    const reply = await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'FROZEN', minutes: 5 });
    expect(reply).toMatchObject({ ok: true, mode: 'FROZEN' });

    report(bravo, room, P2, 'ACTIVE');
    await settle(bravo);
    await waitFor(() => entryOf(alpha, B)?.status === 'FROZEN');
    expect(entryOf(alpha, B)).toMatchObject({ lat: P1.lat, lng: P1.lng, hasFix: true, holdUntil: reply.until });
    // The Lead's table holds the same spot, not where the phone is now.
    const table = once(alpha, 'telemetry-sync-complete');
    alpha.emit('request-telemetry', room, () => {});
    expect((await table)[bravo.id]).toMatchObject({ latitude: P1.lat, longitude: P1.lng });

    const ended = await once(bravo, 'sharing-hold-ended');
    expect(ended).toMatchObject({ reason: 'expired', endedMode: 'FROZEN' });
    // Not shown at the old spot as if it were live: no position until a live one comes.
    await waitFor(() => entryOf(alpha, B)?.status === 'ACTIVE');
    expect(entryOf(alpha, B).hasFix).toBe(false);
    expect(await logKinds(alpha, room, B)).toEqual(['went-paused', 'back-from-paused']);
  });

  it('ends early when the member goes Live, and going from Paused to Hidden logs both', async () => {
    const { room, alpha, bravo, B } = await group(on);
    report(bravo, room, P1);
    await waitFor(() => entryOf(alpha, B)?.hasFix);
    expect((await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'FROZEN', minutes: 10 })).ok).toBe(true);
    expect((await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 10 })).ok).toBe(true);
    await waitFor(() => entryOf(alpha, B)?.status === 'GHOST');
    const ended = once(bravo, 'sharing-hold-ended');
    const reply = await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'ACTIVE' });
    expect(reply).toMatchObject({ ok: true, mode: 'ACTIVE', until: null });
    expect(await ended).toMatchObject({ reason: 'resumed', endedMode: 'GHOST' });
    await waitFor(() => entryOf(alpha, B)?.status === 'ACTIVE');
    expect(await logKinds(alpha, room, B)).toEqual(['went-paused', 'back-from-paused', 'went-hidden', 'back-from-hidden']);
  });

  it('is never granted by the phone claiming it: an unasked pause is listed, without a position', async () => {
    const { room, alpha, bravo, B } = await group(on);
    report(bravo, room, P1, 'FROZEN');
    await settle(bravo);
    await waitFor(() => entryOf(alpha, B));
    await sleep(30);
    expect(entryOf(alpha, B)).toMatchObject({ status: 'ACTIVE', hasFix: false });
    expect(entryOf(alpha, B).lat).toBeUndefined();
  });
});

describe('restarting the app mid-hold', () => {
  it('gets the same end time back, and the hold still decides what the Group sees', async () => {
    const { room, alpha, bravo, B } = await group(on);
    const reply = await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 20 });
    expect(reply.ok).toBe(true);
    bravo.disconnect();
    await sleep(50);

    const again = await on.connect();
    const told = once(again, 'sharing-hold');
    const back = await on.returnToSquad(again, room, B);
    expect(back.outcome).toBe('granted');
    expect(await told).toMatchObject({ roomCode: room, mode: 'GHOST', until: reply.until });

    report(again, room, P2, 'ACTIVE');
    await settle(again);
    await sleep(30);
    expect(entryOf(alpha, B)).toMatchObject({ status: 'GHOST', hasFix: false, holdUntil: reply.until });

    // And it still ends on time, on the new connection.
    expect(await once(again, 'sharing-hold-ended')).toMatchObject({ reason: 'expired' });
  });
});

describe('an SOS', () => {
  it("ends the sender's hold, tells their phone, and still reaches their friends and the Lead only", async () => {
    const { room, alpha, bravo, charlie, delta, B } = await group(on, { friends: true });
    report(bravo, room, P1);
    expect((await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 20 })).ok).toBe(true);
    await waitFor(() => entryOf(alpha, B)?.status === 'GHOST');

    const ended = once(bravo, 'sharing-hold-ended');
    bravo.emit('sos-broadcast', { lat: P1.lat, lng: P1.lng, roomCode: room, timestamp: Date.now(), clientId: 'sos-1' });
    expect(await ended).toMatchObject({ reason: 'sos', endedMode: 'GHOST', mode: 'ACTIVE' });
    await waitFor(() => alpha.sos.length && charlie.sos.length);
    await sleep(100);
    expect(delta.sos).toEqual([]);
    await waitFor(() => entryOf(alpha, B)?.status === 'ACTIVE');
    expect(entryOf(alpha, B).holdUntil).toBeUndefined();
  });
});

describe('the rolling-hour allowance', () => {
  it('is not reset by resuming, and refuses more than is left, saying how much is', async () => {
    const { room, bravo } = await group(on);
    const first = await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'FROZEN', minutes: 30 });
    expect(first).toMatchObject({ ok: true, allowanceLeftMs: 0 });
    await sleep(2 * MINUTE);
    const resumed = await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'ACTIVE' });
    expect(resumed.ok).toBe(true);
    // About two minutes used: about 28 left, never a fresh 30.
    expect(resumed.allowanceLeftMs).toBeLessThanOrEqual(28 * MINUTE);
    expect(resumed.allowanceLeftMs).toBeGreaterThan(25 * MINUTE);

    const refused = await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 30 });
    expect(refused).toMatchObject({ ok: false, reason: 'allowance' });
    expect(refused.allowanceLeftMs).toBeLessThan(30 * MINUTE);
    // Pause and Hidden share it.
    expect((await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'FROZEN', minutes: 30 })).reason).toBe('allowance');
    expect((await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 20 })).ok).toBe(true);
  });

  it('refuses a hold over 30 minutes, a bad mode, and anyone not in the Group', async () => {
    const { room, bravo } = await group(on);
    expect(await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 31 })).toMatchObject({ ok: false, reason: 'bad-minutes' });
    expect(await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 0 })).toMatchObject({ ok: false, reason: 'bad-minutes' });
    expect(await ask(bravo, 'set-sharing-mode', { roomCode: room, mode: 'SLEEP', minutes: 5 })).toMatchObject({ ok: false, reason: 'bad-mode' });
    const stranger = await on.connect();
    expect(await ask(stranger, 'set-sharing-mode', { roomCode: room, mode: 'GHOST', minutes: 5 })).toEqual({ ok: false, reason: 'not-in-squad' });
    for (const bad of [undefined, null, 7, 'x', { roomCode: 5 }]) bravo.emit('set-sharing-mode', bad);
    await settle(bravo);
    expect(on.serverIsAlive()).toBe(true);
  });
});
