import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, settle, once } from './helpers/e2eServer.js';

// Nearby Join end to end (backend/nearby.js and server.js): the real server, real Socket.IO clients.
// Shortened for the tests: the pre-join close is 400 ms, a lobby position is stale after 500 ms, an
// invite lasts 600 ms, a hold "minute" is 100 ms. 15 m and the accuracy rule are as shipped.
const PRE_JOIN = 400;
const STALE = 500;
const INVITE_TTL = 600;
const on = e2eServer({
  env: {
    LOCUS_NEARBY_ENABLED: 'true',
    LOCUS_PRE_JOIN_TIMEOUT_MS: String(PRE_JOIN),
    LOCUS_NEARBY_MAX_FIX_AGE_MS: String(STALE),
    LOCUS_NEARBY_INVITE_TTL_MS: String(INVITE_TTL),
    LOCUS_TIMED_PRIVACY_ENABLED: 'true',
    LOCUS_HOLD_MINUTE_MS: '100',
    LOCUS_LEAVE_APPROVAL_ENABLED: 'true',
  },
});
// As shipped: Nearby off (leave approval on, to show a Nearby-made Group is still not marked).
const off = e2eServer({ env: { LOCUS_PRE_JOIN_TIMEOUT_MS: String(PRE_JOIN), LOCUS_LEAVE_APPROVAL_ENABLED: 'true' } });

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const collect = (socket, event) => {
  const seen = [];
  socket.on(event, (p) => seen.push(p ?? {}));
  return seen;
};
const closed = (socket) => new Promise((resolve) => (socket.connected ? socket.once('disconnect', resolve) : resolve()));
const withinAMoment = (promise, ms = 250) => Promise.race([promise, sleep(ms).then(() => 'nothing')]);

// Metres north of the presser.
const ONE_M = 1 / 111_320;
const HERE = { lat: 12.8231, lng: 80.0442 };
// accuracy: metres, or NONE for a phone that sends none (an older app).
const NONE = Symbol('no accuracy');
const at = (northM, accuracy = 5) => ({ lat: HERE.lat + northM * ONE_M, lng: HERE.lng, ...(accuracy === NONE ? {} : { accuracy }) });

let seq = 0;
const next = () => ++seq;

// Someone in no Group, discoverable at `where`.
const lobby = async (api, name, where = at(8)) => {
  const socket = await api.connect();
  socket.invites = collect(socket, 'nearby-invite');
  const uid = `L${next()}-${name}`;
  expect(await ask(socket, 'nearby-discoverable', { on: true, user: { uid, name }, ...where })).toEqual({ ok: true, discoverable: true });
  socket.uid = uid;
  return socket;
};
// A Group led by Alpha, standing at HERE.
const leader = async (api, extra = {}) => {
  const room = `NY${next()}`;
  const alpha = await api.connect();
  alpha.answers = collect(alpha, 'nearby-invite-answered');
  const granted = once(alpha, 'access-granted');
  alpha.emit('request-join', { roomCode: room, user: { uid: `lead-${room}`, name: 'Alpha' }, intent: 'create', ...extra });
  await granted;
  alpha.uid = `lead-${room}`;
  return { room, alpha };
};
const scan = (socket, room, where = at(0)) => ask(socket, 'nearby-scan', { roomCode: room, ...where });
const names = (reply) => reply.people.map((p) => p.name).sort();

describe('with Nearby switched off (as shipped)', () => {
  it('answers every Nearby event "disabled", keeps no lobby connection open, and marks no Group', async () => {
    const socket = await off.connect();
    expect(await ask(socket, 'nearby-discoverable', { on: true, user: { uid: 'offU', name: 'U' }, ...at(1) })).toEqual({ ok: false, reason: 'disabled' });
    // The pre-join close still applies: asking to be discoverable kept nothing open.
    await withinAMoment(closed(socket), PRE_JOIN + 400);
    expect(socket.connected).toBe(false);

    const room = 'NYOFF';
    const alpha = await off.connect();
    const settings = once(alpha, 'group-settings');
    alpha.emit('request-join', { roomCode: room, user: { uid: 'offLead', name: 'Alpha' }, intent: 'create', nearby: true });
    expect((await settings).leaveApproval).toBeUndefined();
    for (const event of ['nearby-scan', 'nearby-invite', 'nearby-respond']) {
      expect(await ask(alpha, event, { roomCode: room, all: true, inviteId: 'x', accept: true })).toEqual({ ok: false, reason: 'disabled' });
    }
  });
});

describe('the lobby close', () => {
  it('still closes a connection that is not discoverable', async () => {
    const socket = await on.connect();
    await withinAMoment(closed(socket), PRE_JOIN + 400);
    expect(socket.connected).toBe(false);
  });

  it('keeps a discoverable person open, and closes them again after they opt out', async () => {
    const person = await lobby(on, 'Opal');
    await sleep(PRE_JOIN + 200);
    expect(person.connected).toBe(true);
    expect(await ask(person, 'nearby-discoverable', { on: false })).toEqual({ ok: true, discoverable: false });
    await withinAMoment(closed(person), PRE_JOIN + 400);
    expect(person.connected).toBe(false);
  });
});

describe('a scan', () => {
  it('lists a discoverable person 8 m away, by name only, with an id that is not their account', async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Nina');
    const reply = await scan(alpha, room);
    expect(reply).toMatchObject({ ok: true, hereUsable: true });
    const listed = reply.people.find((p) => p.name === 'Nina');
    expect(Object.keys(listed).sort()).toEqual(['id', 'name']);
    expect(listed.id).not.toContain(person.uid);
    expect(JSON.stringify(reply)).not.toMatch(/12\.82|80\.04|lat|lng|accuracy/);
  });

  it('never lists a stranger outside 15 m', async () => {
    const { room, alpha } = await leader(on);
    await lobby(on, 'Near', at(14));
    await lobby(on, 'Far', at(30));
    expect(names(await scan(alpha, room))).toEqual(['Near']);
  });

  it('never lists a stale position, a rough one, or one with no accuracy', async () => {
    const { room, alpha } = await leader(on);
    const stale = await lobby(on, 'Stale', at(5));
    await lobby(on, 'Rough', at(5, 20));
    await lobby(on, 'NoAccuracy', at(5, NONE));
    await lobby(on, 'Good', at(5, 15));
    await sleep(STALE + 50); // Stale and the others stop being fresh ...
    stale.emit('nearby-position', at(5)); // ... except that Stale sends again
    await settle(stale);
    // Only Stale's fresh report is fresh now: the others were sent before the wait.
    expect(names(await scan(alpha, room))).toEqual(['Stale']);
  });

  it('lists only those whose fresh position is good', async () => {
    const { room, alpha } = await leader(on);
    await lobby(on, 'Rough2', at(5, 20));
    await lobby(on, 'NoAccuracy2', at(5, NONE));
    await lobby(on, 'Good2', at(5, 15));
    expect(names(await scan(alpha, room))).toEqual(['Good2']);
  });

  it("is empty when the presser's own position is too rough to compare", async () => {
    const { room, alpha } = await leader(on);
    await lobby(on, 'Pat');
    expect(await scan(alpha, room, at(0, 40))).toEqual({ ok: true, people: [], hereUsable: false });
    expect(await scan(alpha, room, { lat: HERE.lat, lng: HERE.lng })).toEqual({ ok: true, people: [], hereUsable: false });
  });

  it('never lists someone who stopped being discoverable', async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Quinn');
    expect(names(await scan(alpha, room))).toContain('Quinn');
    await ask(person, 'nearby-discoverable', { on: false });
    expect(names(await scan(alpha, room))).not.toContain('Quinn');
    const gone = await lobby(on, 'Rae');
    gone.disconnect();
    await sleep(30);
    expect(names(await scan(alpha, room))).not.toContain('Rae');
  });

  it('never lists someone already in a Group; they cannot even be discoverable', async () => {
    const { room, alpha } = await leader(on);
    const other = await leader(on);
    const member = await on.connect();
    await on.admit(other.alpha, member, other.room, 'inGroupU');
    expect(await ask(member, 'nearby-discoverable', { on: true, user: { uid: 'inGroupU', name: 'Ivy' }, ...at(3) })).toEqual({ ok: false, reason: 'in-group' });
    // Nor on a second phone in the lobby.
    const lobbyPhone = await on.connect();
    expect(await ask(lobbyPhone, 'nearby-discoverable', { on: true, user: { uid: 'inGroupU', name: 'Ivy' }, ...at(3) })).toEqual({ ok: false, reason: 'in-group' });
    expect(names(await scan(alpha, room))).not.toContain('Ivy');
  });

  it('drops someone who joins a Group on another phone while still discoverable on this one', async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Duo');
    expect(names(await scan(alpha, room))).toContain('Duo');
    const other = await leader(on);
    await on.admit(other.alpha, await on.connect(), other.room, person.uid);
    expect(names(await scan(alpha, room))).not.toContain('Duo');
  });

  it('never takes a lobby position from someone who is not discoverable', async () => {
    const { room, alpha } = await leader(on);
    const quiet = await on.connect();
    quiet.emit('nearby-position', at(3));
    const member = await on.connect();
    await on.admit(alpha, member, room, `pos-member-${room}`);
    member.emit('nearby-position', at(3));
    await Promise.all([settle(quiet), settle(member)]);
    expect(await scan(alpha, room)).toEqual({ ok: true, people: [], hereUsable: true });
  });

  it('never lists someone Hidden or Paused', async () => {
    const { room, alpha } = await leader(on);
    for (const [name, mode] of [['Hid', 'GHOST'], ['Paus', 'FROZEN']]) {
      // In a Group, they hide (or pause) for 20 "minutes", then leave it: their hold stays with them.
      const g = await leader(on);
      const socket = await on.connect();
      const uid = `held-${name}-${next()}`;
      await on.admit(g.alpha, socket, g.room, uid);
      expect((await ask(socket, 'set-sharing-mode', { roomCode: g.room, mode, minutes: 20 })).ok).toBe(true);
      socket.emit('leave-squad');
      await settle(socket);
      expect(await ask(socket, 'nearby-discoverable', { on: true, user: { uid, name }, ...at(4) })).toEqual({ ok: true, discoverable: true });
    }
    await lobby(on, 'Visible', at(4));
    expect(names(await scan(alpha, room))).toEqual(['Visible']);
  });

  it("never lists someone the presser's Group blocked; another Group still sees them", async () => {
    const { room, alpha } = await leader(on);
    const member = await on.connect();
    await on.admit(alpha, member, room, 'blockedU');
    const exiled = once(member, 'exiled');
    expect(await ask(alpha, 'block-user', { roomCode: room, targetId: member.id })).toEqual({ ok: true });
    await exiled;
    expect(await ask(member, 'nearby-discoverable', { on: true, user: { uid: 'blockedU', name: 'Bo' }, ...at(4) })).toEqual({ ok: true, discoverable: true });
    expect(names(await scan(alpha, room))).not.toContain('Bo');
    const other = await leader(on);
    expect(names(await scan(other.alpha, other.room))).toContain('Bo');
  });

  it('may be made by the admin and moderators, not by members', async () => {
    const { room, alpha } = await leader(on);
    const [mod, member] = [await on.connect(), await on.connect()];
    await on.admit(alpha, mod, room, `mod-${room}`);
    await on.admit(alpha, member, room, `mem-${room}`);
    expect(await ask(alpha, 'set-moderator', { roomCode: room, targetId: mod.id, moderator: true })).toEqual({ ok: true });
    await lobby(on, 'Sam');
    expect(names(await scan(mod, room))).toContain('Sam');
    expect(await scan(member, room)).toEqual({ ok: false, reason: 'not-allowed' });
    const stranger = await on.connect();
    expect(await scan(stranger, room)).toEqual({ ok: false, reason: 'not-in-squad' });
  });

  it('is rate-limited', async () => {
    const { room, alpha } = await leader(on);
    for (let i = 0; i < 6; i += 1) expect((await scan(alpha, room)).ok).toBe(true);
    expect(await scan(alpha, room)).toMatchObject({ ok: false, reason: 'too-many' });
  });
});

describe('an invite', () => {
  it('admits the person at once when they accept, and tells whoever invited', async () => {
    const { room, alpha } = await leader(on);
    const roster = collect(alpha, 'users-update');
    const person = await lobby(on, 'Tess');
    const { people } = await scan(alpha, room);
    expect(await ask(alpha, 'nearby-invite', { roomCode: room, ids: [people[0].id] })).toEqual({ ok: true, invited: 1 });
    await waitFor(() => person.invites.length);
    const invite = person.invites[0];
    expect(invite).toMatchObject({ fromName: 'Alpha' });
    expect(Object.keys(invite).sort()).toEqual(['expiresAt', 'fromName', 'inviteId', 'serverNow']);
    // Nobody is added before they tap.
    await sleep(50);
    expect(roster.some((list) => Object.values(list).some((e) => e.uid === person.uid))).toBe(false);

    const granted = once(person, 'access-granted');
    expect(await ask(person, 'nearby-respond', { inviteId: invite.inviteId, accept: true })).toEqual({ ok: true, roomCode: room });
    expect(await granted).toEqual({ role: 'MEMBER', roomCode: room });
    await waitFor(() => roster.some((list) => Object.values(list).some((e) => e.uid === person.uid)));
    await waitFor(() => alpha.answers.some((a) => a.accepted === true && a.name === 'Tess'));
    // A member now: past the lobby close, and no longer listed.
    await sleep(PRE_JOIN + 100);
    expect(person.connected).toBe(true);
    expect(names(await scan(alpha, room))).not.toContain('Tess');
    // Their join is the normal one: positions are taken from them as from anyone admitted.
    person.emit('update-location', { roomCode: room, ...at(8), status: 'ACTIVE' });
    await waitFor(() => roster.some((list) => Object.values(list).some((e) => e.uid === person.uid && e.hasFix)));
  });

  it('is refused a second time, once used', async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Uma');
    const { people } = await scan(alpha, room);
    await ask(alpha, 'nearby-invite', { roomCode: room, ids: [people[0].id] });
    await waitFor(() => person.invites.length);
    const { inviteId } = person.invites[0];
    expect((await ask(person, 'nearby-respond', { inviteId, accept: true })).ok).toBe(true);
    expect(await ask(person, 'nearby-respond', { inviteId, accept: true })).toEqual({ ok: false, reason: 'used' });
  });

  it('declined: only the invite closes; they stay where they were', async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Vic');
    const { people } = await scan(alpha, room);
    await ask(alpha, 'nearby-invite', { roomCode: room, ids: [people[0].id] });
    await waitFor(() => person.invites.length);
    const { inviteId } = person.invites[0];
    expect(await ask(person, 'nearby-respond', { inviteId, accept: false })).toEqual({ ok: true });
    await waitFor(() => alpha.answers.some((a) => a.accepted === false && a.name === 'Vic'));
    expect(await ask(person, 'nearby-respond', { inviteId, accept: true })).toEqual({ ok: false, reason: 'used' });
    expect(names(await scan(alpha, room))).toContain('Vic');
  });

  it('answered just after it ran out, is refused as expired', async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Wyn');
    const { people } = await scan(alpha, room);
    await ask(alpha, 'nearby-invite', { roomCode: room, ids: [people[0].id] });
    await waitFor(() => person.invites.length);
    await sleep(INVITE_TTL + 20);
    expect(await ask(person, 'nearby-respond', { inviteId: person.invites[0].inviteId, accept: true })).toEqual({ ok: false, reason: 'expired' });
  });

  it('runs out: an expired invite is refused, and the person is told it has gone', async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Wes');
    const expired = collect(person, 'nearby-invite-expired');
    const { people } = await scan(alpha, room);
    await ask(alpha, 'nearby-invite', { roomCode: room, ids: [people[0].id] });
    await waitFor(() => person.invites.length);
    const { inviteId } = person.invites[0];
    // Told when it runs out (the server checks every second) ...
    await waitFor(() => expired.some((e) => e.inviteId === inviteId), { timeout: INVITE_TTL + 1500 });
    // ... and an answer after that is refused as expired.
    expect(await ask(person, 'nearby-respond', { inviteId, accept: true })).toEqual({ ok: false, reason: 'expired' });
  });

  it('is one open invite per person per Group: asking again sends no second prompt', async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Xan');
    const { people } = await scan(alpha, room);
    await ask(alpha, 'nearby-invite', { roomCode: room, ids: [people[0].id] });
    await ask(alpha, 'nearby-invite', { roomCode: room, ids: [people[0].id] });
    await settle(person);
    await sleep(50);
    expect(person.invites).toHaveLength(1);
  });

  it('"Add all" invites everyone listed, and each one still has to accept', async () => {
    const { room, alpha } = await leader(on);
    const roster = collect(alpha, 'users-update');
    const [p1, p2] = [await lobby(on, 'Yara'), await lobby(on, 'Zed')];
    await scan(alpha, room);
    expect(await ask(alpha, 'nearby-invite', { roomCode: room, all: true })).toEqual({ ok: true, invited: 2 });
    await waitFor(() => p1.invites.length && p2.invites.length);
    await sleep(50);
    const inRoster = (uid) => roster.some((list) => Object.values(list).some((e) => e.uid === uid));
    expect(inRoster(p1.uid) || inRoster(p2.uid)).toBe(false);
    expect((await ask(p1, 'nearby-respond', { inviteId: p1.invites[0].inviteId, accept: true })).ok).toBe(true);
    await waitFor(() => inRoster(p1.uid));
    await sleep(50);
    expect(inRoster(p2.uid)).toBe(false);
  });

  it('needs a scan first, and only reaches people in it', async () => {
    const { room, alpha } = await leader(on);
    expect(await ask(alpha, 'nearby-invite', { roomCode: room, all: true })).toEqual({ ok: false, reason: 'scan-first' });
    const person = await lobby(on, 'Abe');
    await scan(alpha, room);
    expect(await ask(alpha, 'nearby-invite', { roomCode: room, ids: [person.uid, 'made-up'] })).toEqual({ ok: true, invited: 0 });
    await settle(person);
    expect(person.invites).toEqual([]);
  });

  it("cannot be answered by anyone but the person it is for", async () => {
    const { room, alpha } = await leader(on);
    const person = await lobby(on, 'Bea');
    const other = await lobby(on, 'Cal', at(30));
    const { people } = await scan(alpha, room);
    await ask(alpha, 'nearby-invite', { roomCode: room, ids: people.map((p) => p.id) });
    await waitFor(() => person.invites.length);
    expect(await ask(other, 'nearby-respond', { inviteId: person.invites[0].inviteId, accept: true })).toEqual({ ok: false, reason: 'no-invite' });
    expect(await ask(await on.connect(), 'nearby-respond', { inviteId: person.invites[0].inviteId, accept: true })).toEqual({ ok: false, reason: 'identity' });
  });
});

describe('pressing Nearby with no Group', () => {
  it('creates a Group through the usual create, marked as needing approval to leave', async () => {
    const alpha = await on.connect();
    const settings = once(alpha, 'group-settings');
    alpha.emit('request-join', { roomCode: `NY${next()}`, user: { uid: `solo-${seq}`, name: 'Solo' }, intent: 'create', nearby: true });
    expect(await settings).toMatchObject({ leaveApproval: true });
  });

  it('without the Nearby flag, the create is as it always was', async () => {
    const alpha = await on.connect();
    const settings = once(alpha, 'group-settings');
    alpha.emit('request-join', { roomCode: `NY${next()}`, user: { uid: `plain-${seq}`, name: 'Plain' }, intent: 'create' });
    expect((await settings).leaveApproval).toBeUndefined();
  });
});

describe('malformed Nearby events', () => {
  it('are refused without harm', async () => {
    const { room, alpha } = await leader(on);
    // Slowly: a connection may send 30 events a second, and the rest of that second is dropped.
    for (const event of ['nearby-discoverable', 'nearby-position', 'nearby-scan', 'nearby-invite', 'nearby-respond']) {
      for (const bad of [undefined, null, 7, 'x', { on: true, user: 5 }, { roomCode: 5 }, { roomCode: room, ids: 'all' }, { inviteId: 5, accept: 'yes' }]) {
        alpha.emit(event, bad);
        await settle(alpha);
        await sleep(80);
      }
    }
    expect(on.serverIsAlive()).toBe(true);
  });
});
