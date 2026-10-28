import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor } from './helpers/e2eServer.js';

/**
 * A Group that outlives everyone's phones sleeping, an SOS answered once however often it is
 * sent, and the same account on a second phone, end to end: real server, real sockets.
 *
 * Each used to go wrong. The first member back while nobody else was connected was told the
 * Group had ended; a minute with every phone asleep deleted it, so everyone had to be approved
 * again; a resent SOS hit the cooldown its first copy started and read as refused; and the older
 * of two phones on one account was cut off without a word.
 */

const SWEEP_MS = 100;
const GRACE_MS = 1500;
const { connect, createSquad, admit, requestJoin, squadOfThree, newRoom } = e2eServer({
  env: { LOCUS_SWEEP_INTERVAL_MS: String(SWEEP_MS), LOCUS_EMPTY_GROUP_GRACE_MS: String(GRACE_MS) },
});

describe('a Group nobody is connected to', () => {
  it('lets a member back without approval, and is not "ended", while no one else is connected', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    [alpha, bravo, charlie].forEach((s) => s.disconnect());
    await sleep(SWEEP_MS * 3);
    const back = await connect();
    expect(await requestJoin(back, room, 'uB')).toMatchObject({ outcome: 'granted' });
  });

  it('is kept for the grace period: its Commander and members come back to it, no approvals', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    alpha.disconnect();
    bravo.disconnect();
    await sleep(GRACE_MS / 2);
    const commander = await connect();
    expect(await requestJoin(commander, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    const member = await connect();
    expect(await requestJoin(member, room, 'uB')).toMatchObject({ outcome: 'granted', role: 'MEMBER' });
  });

  it('cannot be taken over under its code while it is kept', async () => {
    const room = newRoom();
    const owner = await connect();
    await createSquad(owner, room, 'uO');
    owner.disconnect();
    await sleep(SWEEP_MS * 3);
    const stranger = await connect();
    const taken = new Promise((resolve) => stranger.once('squad-code-taken', () => resolve(true)));
    stranger.emit('request-join', { roomCode: room, intent: 'create', user: { uid: 'uStranger', name: 'S' } });
    expect(await taken).toBe(true);
  });

  it('is gone once the grace period passes with nobody back', async () => {
    const room = newRoom();
    const owner = await connect();
    await createSquad(owner, room, 'uO');
    owner.disconnect();
    await sleep(GRACE_MS + SWEEP_MS * 4);
    const later = await connect();
    expect(await requestJoin(later, room, 'uL')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
  });
});

describe('an SOS sent again because its answer never came', () => {
  it('is answered as delivered, not refused by the cooldown, and reaches the Group once', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    const answers = [];
    bravo.on('alert-result', (r) => answers.push(r));
    const alert = { senderName: 'Bravo', lat: 12.82, lng: 80.04, roomCode: room, clientId: 'alert-1' };
    bravo.emit('sos-broadcast', alert);
    await waitFor(() => answers.length === 1);
    bravo.emit('sos-broadcast', alert);
    await waitFor(() => answers.length === 2);
    expect(answers.map((a) => [a.allowed, a.clientId])).toEqual([[true, 'alert-1'], [true, 'alert-1']]);
    expect(answers[1].duplicate).toBe(true);
    await sleep(100);
    expect(alpha.sos.filter((s) => s.senderName === 'Bravo')).toHaveLength(1);
  });
});

describe('the same account on a second phone', () => {
  it('tells the first phone, which the Group no longer reaches', async () => {
    const room = newRoom();
    const [alpha, first] = [await connect(), await connect()];
    await createSquad(alpha, room, 'uA');
    await admit(alpha, first, room, 'uB');
    const told = new Promise((resolve) => first.once('signed-in-elsewhere', resolve));
    const second = await connect();
    expect(await requestJoin(second, room, 'uB')).toMatchObject({ outcome: 'granted' });
    expect(await told).toMatchObject({ roomCode: room });
  });
});
