import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, settle, once } from './helpers/e2eServer.js';

// Someone admitted through a Nearby invite is not picked to stand in for an absent admin until
// NEARBY_CARETAKER_WAIT_MS after joining (24 hours; 800 ms here). The real server, real clients.
const WAIT = 800;
const api = e2eServer({ env: { LOCUS_NEARBY_ENABLED: 'true', LOCUS_NEARBY_CARETAKER_WAIT_MS: String(WAIT) } });

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const collect = (socket, event) => {
  const seen = [];
  socket.on(event, (p) => seen.push(p ?? {}));
  return seen;
};
const HERE = { lat: 12.8231, lng: 80.0442, accuracy: 5 };
const NEAR = { lat: 12.8231 + 8 / 111_320, lng: 80.0442, accuracy: 5 };

let seq = 0;
const leader = async () => {
  const n = ++seq;
  const room = `CT${n}`;
  const alpha = await api.connect();
  const granted = once(alpha, 'access-granted');
  alpha.emit('request-join', { roomCode: room, user: { uid: `ct-lead-${n}`, name: 'Alpha' }, intent: 'create' });
  await granted;
  return { room, alpha, n };
};
// Someone in the lobby, invited by Nearby and accepting: a member of `room` now.
const inviteIn = async (alpha, room, uid) => {
  const person = await api.connect();
  const invited = once(person, 'nearby-invite');
  expect((await ask(person, 'nearby-discoverable', { on: true, user: { uid, name: uid }, ...NEAR })).ok).toBe(true);
  const { people } = await ask(alpha, 'nearby-scan', { roomCode: room, ...HERE });
  await ask(alpha, 'nearby-invite', { roomCode: room, ids: people.map((p) => p.id) });
  const { inviteId } = await invited;
  const granted = once(person, 'access-granted');
  expect((await ask(person, 'nearby-respond', { inviteId, accept: true })).ok).toBe(true);
  expect(await granted).toMatchObject({ role: 'MEMBER' });
  return person;
};
// A stranger asking to join while the admin is away: someone is promoted to hold the queue, or nobody.
const strangerAsks = async (room) => {
  const stranger = await api.connect();
  expect((await api.requestJoin(stranger, room, `stranger-${++seq}`)).outcome).toBe('pending');
};

describe('a member admitted through a Nearby invite', () => {
  it('is skipped as stand-in while new; a normal member is promoted instead', async () => {
    const { room, alpha, n } = await leader();
    const invitee = await inviteIn(alpha, room, `ct-inv-${n}`); // first on the roster after the admin
    const member = await api.connect();
    await api.admit(alpha, member, room, `ct-mem-${n}`);
    const inviteePromoted = collect(invitee, 'promoted-to-owner');
    const promoted = once(member, 'promoted-to-owner');
    alpha.disconnect();
    await sleep(50);
    await strangerAsks(room);
    expect(await promoted).toEqual({ roomCode: room });
    await settle(invitee);
    expect(inviteePromoted).toEqual([]);
  });

  it('when they are the only one connected, the Group has no stand-in for now', async () => {
    const { room, alpha, n } = await leader();
    const invitee = await inviteIn(alpha, room, `ct-only-${n}`);
    const promoted = collect(invitee, 'promoted-to-owner');
    alpha.disconnect();
    await sleep(50);
    await strangerAsks(room);
    await settle(invitee);
    await sleep(100);
    expect(promoted).toEqual([]);
    // Nor do they take over as caretaker by coming back: they return as a member.
    invitee.disconnect();
    await sleep(50);
    const again = await api.connect();
    expect(await api.returnToSquad(again, room, `ct-only-${n}`)).toMatchObject({ outcome: 'granted', role: 'MEMBER' });
  });

  it('becomes eligible once the wait is over, like any member', async () => {
    const { room, alpha, n } = await leader();
    const invitee = await inviteIn(alpha, room, `ct-old-${n}`);
    await sleep(WAIT + 100);
    const promoted = once(invitee, 'promoted-to-owner');
    alpha.disconnect();
    await sleep(50);
    await strangerAsks(room);
    expect(await promoted).toEqual({ roomCode: room });
  });

  it('after the wait, coming back while the admin is away makes them caretaker, as for any member', async () => {
    const { room, alpha, n } = await leader();
    const invitee = await inviteIn(alpha, room, `ct-care-${n}`);
    await sleep(WAIT + 100);
    alpha.disconnect();
    invitee.disconnect();
    await sleep(50);
    const again = await api.connect();
    expect(await api.returnToSquad(again, room, `ct-care-${n}`)).toMatchObject({ outcome: 'granted', role: 'OWNER' });
  });

  it('counts as any member once admitted the usual way', async () => {
    const { room, alpha, n } = await leader();
    const uid = `ct-again-${n}`;
    const invitee = await inviteIn(alpha, room, uid);
    invitee.emit('leave-squad');
    await settle(invitee);
    const back = await api.connect();
    await api.admit(alpha, back, room, uid); // approved by the admin, as anyone is
    const promoted = once(back, 'promoted-to-owner');
    alpha.disconnect();
    await sleep(50);
    await strangerAsks(room);
    expect(await promoted).toEqual({ roomCode: room });
  });
});

describe('when whoever holds command leaves on purpose', () => {
  it('a fresh invitee is skipped; a normal member takes over', async () => {
    const { room, alpha, n } = await leader();
    const invitee = await inviteIn(alpha, room, `ct-exit-inv-${n}`); // first in line after the admin
    const member = await api.connect();
    await api.admit(alpha, member, room, `ct-exit-mem-${n}`);
    const inviteePromoted = collect(invitee, 'promoted-to-owner');
    const promoted = once(member, 'promoted-to-owner');
    alpha.emit('leave-squad');
    expect(await promoted).toEqual({ roomCode: room });
    await settle(invitee);
    expect(inviteePromoted).toEqual([]);
  });

  it('with only a fresh invitee left, the Group has no leader for now, as when its leader is offline', async () => {
    const { room, alpha, n } = await leader();
    const invitee = await inviteIn(alpha, room, `ct-exit-only-${n}`);
    const promoted = collect(invitee, 'promoted-to-owner');
    const roles = collect(invitee, 'group-role');
    alpha.emit('leave-squad');
    await settle(alpha);
    await settle(invitee);
    await sleep(100);
    expect(promoted).toEqual([]);
    expect(roles.at(-1)).toMatchObject({ role: 'member' });
    // A stranger asking waits: nobody to answer, and the invitee is not made to.
    await strangerAsks(room);
    await settle(invitee);
    expect(promoted).toEqual([]);
    // Nor does the invitee take over by coming back.
    invitee.disconnect();
    await sleep(50);
    const again = await api.connect();
    expect(await api.returnToSquad(again, room, `ct-exit-only-${n}`)).toMatchObject({ outcome: 'granted', role: 'MEMBER' });
  });

  it('after the wait, an invitee takes over as any member would', async () => {
    const { room, alpha, n } = await leader();
    const invitee = await inviteIn(alpha, room, `ct-exit-old-${n}`);
    await sleep(WAIT + 100);
    const promoted = once(invitee, 'promoted-to-owner');
    alpha.emit('leave-squad');
    expect(await promoted).toEqual({ roomCode: room });
  });

  it('a stand-in leaving on purpose skips a fresh invitee too', async () => {
    const { room, alpha, n } = await leader();
    const standInUid = `ct-standin-${n}`;
    let standIn = await api.connect();
    await api.admit(alpha, standIn, room, standInUid);
    const invitee = await inviteIn(alpha, room, `ct-si-inv-${n}`);
    const member = await api.connect();
    await api.admit(alpha, member, room, `ct-si-mem-${n}`);
    // The admin goes offline; the first member back takes over as caretaker.
    alpha.disconnect();
    standIn.disconnect();
    await sleep(50);
    standIn = await api.connect();
    expect(await api.returnToSquad(standIn, room, standInUid)).toMatchObject({ role: 'OWNER' });
    const inviteePromoted = collect(invitee, 'promoted-to-owner');
    const promoted = once(member, 'promoted-to-owner');
    standIn.emit('leave-squad');
    expect(await promoted).toEqual({ roomCode: room });
    await settle(invitee);
    expect(inviteePromoted).toEqual([]);
  });
});

describe('a member admitted the usual way', () => {
  it('is promoted as before', async () => {
    const { room, alpha, n } = await leader();
    const member = await api.connect();
    await api.admit(alpha, member, room, `ct-plain-${n}`);
    const promoted = once(member, 'promoted-to-owner');
    alpha.disconnect();
    await sleep(50);
    await strangerAsks(room);
    expect(await promoted).toEqual({ roomCode: room });
  });
});
