import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, once, settle } from './helpers/e2eServer.js';

/**
 * Who may run a squad while its Commander is away, and handing it back when they return.
 *
 * A Commander's socket dropping (a signal blip, a backgrounded app, a dead phone) used to
 * leave the squad open to anyone with its code: the next join request of any kind made
 * its sender caretaker Commander, with no approval, including a stranger's very first
 * one. And the caretaker's uid replaced the Commander's on the squad, so when the real
 * Commander came back they were let in as a plain member of their own squad.
 *
 * Now only a member the Commander had already let in can stand in for them, a stranger's
 * request waits for a Commander (stand-in or returned) to decide it, and the Commander
 * gets the squad back whenever they return, with the stand-in told they're a member again.
 */

const { connect, createSquad, admit, requestJoin, squadOfThree, newRoom } = e2eServer();

// Every knock on this socket's door from here on.
const watchKnocks = (socket) => {
  const knocks = [];
  socket.on('access-request', (req) => knocks.push(req));
  return knocks;
};

// Every event this socket hears from here on, by name.
const record = (socket) => {
  const heard = [];
  socket.onAny((event, payload) => heard.push({ event, payload }));
  return heard;
};

// A request whose answer hasn't come after a while, reported as such.
const withinAMoment = (promise, ms = 400) =>
  Promise.race([promise, sleep(ms).then(() => ({ outcome: 'no answer' }))]);

// The Commander's phone drops off. `settle` on a survivor is a round trip that the
// server only answers after it has handled the disconnect.
const commanderDrops = async (alpha, survivor) => {
  alpha.disconnect();
  await sleep(50);
  await settle(survivor);
};

describe('while the Commander is away, someone never let into the squad', () => {
  it('is not made Commander by joining with the code', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    await commanderDrops(alpha, bravo);

    const stranger = await connect();
    const outcome = await withinAMoment(requestJoin(stranger, room, 'uStranger'));
    expect(outcome).toEqual({ outcome: 'pending' });
  });

  it('cannot let anyone in either (they are not the Commander)', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    await commanderDrops(alpha, bravo);

    const stranger = await connect();
    await requestJoin(stranger, room, 'uStranger');
    const friend = await connect();
    const friendOutcome = requestJoin(friend, room, 'uFriend');
    await sleep(100);
    stranger.emit('resolve-access', { targetId: friend.id, roomCode: room, approved: true });
    expect(await withinAMoment(friendOutcome)).toEqual({ outcome: 'pending' });
  });

  it('is held for the Commander, who decides it on their return', async () => {
    // Nobody who could stand in is connected: Bravo dropped off too, and the squad is
    // still on file until the sweep reaches it. (The app's own JOIN is refused as
    // squad-not-found here; a request with no intent, from a build older than #26, is
    // what reaches the squad.)
    const room = newRoom();
    const [alpha, bravo] = [await connect(), await connect()];
    await createSquad(alpha, room, 'uA');
    await admit(alpha, bravo, room, 'uB');
    await commanderDrops(alpha, bravo);
    bravo.disconnect();
    await sleep(50);

    const stranger = await connect();
    const outcome = requestJoin(stranger, room, 'uStranger');
    expect(await withinAMoment(outcome)).toEqual({ outcome: 'pending' });

    // Not dropped: the Commander comes back and finds the request waiting.
    const alpha2 = await connect();
    const knocks = watchKnocks(alpha2);
    expect(await requestJoin(alpha2, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await waitFor(() => knocks.length);
    expect(knocks[0]).toMatchObject({ targetId: stranger.id, roomCode: room });

    const granted = once(stranger, 'access-granted');
    alpha2.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    expect(await granted).toEqual({ role: 'MEMBER', roomCode: room });
  });

  it('is put to a member who stands in, when one is connected', async () => {
    // Nobody reconnects, so nobody would ever take over by rejoining: without a stand-in
    // the request would wait on a Commander whose phone may never come back.
    const { room, alpha, bravo, charlie } = await squadOfThree();
    await commanderDrops(alpha, bravo);
    const bravoHears = record(bravo);
    const charlieHears = record(charlie);

    const stranger = await connect();
    const outcome = requestJoin(stranger, room, 'uStranger');
    expect(await withinAMoment(outcome)).toEqual({ outcome: 'pending' });

    // Bravo, first on the roster after Alpha, is promoted and handed the request.
    await waitFor(() => bravoHears.some((h) => h.event === 'access-request'));
    expect(bravoHears.map((h) => h.event)).toContain('promoted-to-owner');
    expect(charlieHears.map((h) => h.event)).not.toContain('promoted-to-owner');

    const granted = once(stranger, 'access-granted');
    bravo.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    expect(await granted).toEqual({ role: 'MEMBER', roomCode: room });
  });
});

describe('while the Commander is away, a member they already let in', () => {
  it('takes over as caretaker when they come back on a new connection', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    await commanderDrops(alpha, bravo);
    bravo.disconnect();

    const bravo2 = await connect();
    expect(await requestJoin(bravo2, room, 'uB')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });

    // And now decides who gets in.
    const knocks = watchKnocks(bravo2);
    const stranger = await connect();
    const granted = once(stranger, 'access-granted');
    expect(await requestJoin(stranger, room, 'uStranger')).toEqual({ outcome: 'pending' });
    await waitFor(() => knocks.length);
    bravo2.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    expect(await granted).toEqual({ role: 'MEMBER', roomCode: room });
  });

  it('cannot block the Commander out of their own squad', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    const alphaOldId = alpha.id;
    await commanderDrops(alpha, bravo);
    bravo.disconnect();
    const bravo2 = await connect();
    await requestJoin(bravo2, room, 'uB');

    bravo2.emit('block-user', { roomCode: room, targetId: alphaOldId });
    await settle(bravo2);

    const alpha2 = await connect();
    expect(await requestJoin(alpha2, room, 'uA')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
  });
});

describe('the Commander coming back', () => {
  // Alpha drops off, Bravo stands in as caretaker (on a new connection), Charlie stays.
  const caretakerSquad = async () => {
    const squad = await squadOfThree();
    await commanderDrops(squad.alpha, squad.bravo);
    squad.bravo.disconnect();
    const bravo2 = await connect();
    await requestJoin(bravo2, squad.room, 'uB');
    return { ...squad, bravo2 };
  };

  it('gets the squad back, and the caretaker is told they are a member again', async () => {
    const { room, bravo2 } = await caretakerSquad();
    const demoted = once(bravo2, 'demoted-to-member');

    const alpha2 = await connect();
    expect(await requestJoin(alpha2, room, 'uA')).toEqual({ outcome: 'granted', role: 'OWNER', roomCode: room });
    expect(await demoted).toEqual({ roomCode: room });
  });

  it('decides new requests from then on; the former caretaker cannot', async () => {
    const { room, bravo2 } = await caretakerSquad();
    const alpha2 = await connect();
    await requestJoin(alpha2, room, 'uA');

    const alphaKnocks = watchKnocks(alpha2);
    const bravoKnocks = watchKnocks(bravo2);
    const stranger = await connect();
    expect(await requestJoin(stranger, room, 'uStranger')).toEqual({ outcome: 'pending' });
    await waitFor(() => alphaKnocks.length);
    expect(bravoKnocks).toEqual([]);

    const granted = once(stranger, 'access-granted');
    bravo2.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    expect(await withinAMoment(granted)).toEqual({ outcome: 'no answer' });
    alpha2.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    expect(await granted).toEqual({ role: 'MEMBER', roomCode: room });
  });

  it('takes over requests that were waiting on the caretaker', async () => {
    const { room, bravo2 } = await caretakerSquad();
    const bravoKnocks = watchKnocks(bravo2);
    const stranger = await connect();
    const granted = once(stranger, 'access-granted');
    stranger.emit('request-join', { roomCode: room, user: { uid: 'uStranger', name: 'uStranger' } });
    await waitFor(() => bravoKnocks.length);

    const alpha2 = await connect();
    const alphaKnocks = watchKnocks(alpha2);
    await requestJoin(alpha2, room, 'uA');
    await waitFor(() => alphaKnocks.length);
    expect(alphaKnocks[0]).toMatchObject({ targetId: stranger.id, roomCode: room });

    alpha2.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    expect(await granted).toEqual({ role: 'MEMBER', roomCode: room });
  });

  it('can run the Commander-only controls again, and the caretaker cannot', async () => {
    const { room, bravo2, charlie } = await caretakerSquad();
    const alpha2 = await connect();
    await requestJoin(alpha2, room, 'uA');

    const ask = (socket) =>
      new Promise((resolve) => socket.emit('request-telemetry', room, resolve));
    expect(await ask(alpha2)).toMatchObject({ ok: true });
    expect(await ask(bravo2)).toMatchObject({ ok: false, reason: 'not-owner' });
    expect(await ask(charlie)).toMatchObject({ ok: false, reason: 'not-owner' });
  });

  it('keeps the former caretaker in the squad as a member', async () => {
    const { room, bravo2, charlie } = await caretakerSquad();
    const alpha2 = await connect();
    await requestJoin(alpha2, room, 'uA');

    // Still on the squad's traffic...
    charlie.emit('sos-broadcast', { senderName: 'Charlie', lat: 1, lng: 2, roomCode: room });
    await waitFor(() => bravo2.sos.length);
    // ...and back as a member, not a Commander, on their own next reconnect.
    bravo2.disconnect();
    const bravo3 = await connect();
    expect(await requestJoin(bravo3, room, 'uB')).toEqual({ outcome: 'granted', role: 'MEMBER', roomCode: room });
  });

  it('gets the squad back from a member promoted in their absence, too', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    await commanderDrops(alpha, bravo);
    const stranger = await connect();
    const promoted = once(bravo, 'promoted-to-owner');
    requestJoin(stranger, room, 'uStranger');
    await promoted;

    const demoted = once(bravo, 'demoted-to-member');
    const alpha2 = await connect();
    expect(await requestJoin(alpha2, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    expect(await demoted).toEqual({ roomCode: room });
  });

  it('does not get it back after leaving on purpose; the member it passed to keeps it', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    const promoted = once(bravo, 'promoted-to-owner');
    alpha.emit('leave-squad');
    await promoted;
    const bravoHears = record(bravo);
    alpha.disconnect();

    const alpha2 = await connect();
    expect(await withinAMoment(requestJoin(alpha2, room, 'uA'))).toEqual({ outcome: 'pending' });
    expect(bravoHears.map((h) => h.event)).not.toContain('demoted-to-member');
  });

  it('when the caretaker leaves on purpose, the squad passes to a connected member, and is still the Commander\'s to reclaim', async () => {
    const { room, bravo2, charlie } = await caretakerSquad();
    const promoted = once(charlie, 'promoted-to-owner');
    bravo2.emit('leave-squad');
    await promoted;

    const demoted = once(charlie, 'demoted-to-member');
    const alpha2 = await connect();
    expect(await requestJoin(alpha2, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await demoted;
  });
});
