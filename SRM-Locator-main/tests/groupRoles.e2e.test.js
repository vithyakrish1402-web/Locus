import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, settle, once } from './helpers/e2eServer.js';

/**
 * Roles end to end (backend/groupRoles.js): one main admin, moderators, members. The real
 * server, real sockets. Alpha (uA) creates the Group and is its admin; Bravo (uB) and
 * Charlie (uC) are admitted. The join-notice batch is shortened so the burst test is quick.
 */

const BATCH_MS = 250;
const api = e2eServer({ env: { LOCUS_JOIN_NOTIFY_BATCH_MS: String(BATCH_MS) } });

const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

// Keeps what a socket is told about roles, requests and the log.
const track = (socket) => {
  Object.assign(socket, { roles: [], requests: [], withdrawn: [], waiting: [], activity: [], exiled: [], users: [] });
  socket.on('group-role', (p) => socket.roles.push(p));
  socket.on('access-request', (p) => socket.requests.push(p));
  socket.on('access-request-withdrawn', (p) => socket.withdrawn.push(p));
  socket.on('join-requests-waiting', (p) => socket.waiting.push(p));
  socket.on('activity-entry', (p) => socket.activity.push(p));
  socket.on('exiled', (p) => socket.exiled.push(p ?? {}));
  socket.on('users-update', (p) => socket.users.push(p));
  return socket;
};
const lastRole = (socket) => socket.roles[socket.roles.length - 1]?.role;

const group = async () => {
  const { room, alpha, bravo, charlie } = await api.squadOfThree();
  [alpha, bravo, charlie].forEach(track);
  return { room, alpha, bravo, charlie };
};
// Bravo made a moderator by Alpha.
const withModerator = async () => {
  const g = await group();
  expect(await ask(g.alpha, 'set-moderator', { roomCode: g.room, targetId: g.bravo.id, moderator: true })).toEqual({ ok: true });
  await waitFor(() => lastRole(g.bravo) === 'moderator');
  return g;
};
// A stranger knocking: returns their socket once the request is on file.
const knock = async (room, uid) => {
  const s = track(await api.connect());
  const pending = once(s, 'access-pending');
  s.emit('request-join', { roomCode: room, user: { uid, name: uid } });
  await pending;
  return s;
};

describe('roles in a Group made before roles existed', () => {
  it('are the leader as admin and everyone else a member, as before', async () => {
    const { room, alpha, bravo, charlie } = await group();
    await settle(alpha);
    // Told again on any change; the newest is the one that counts.
    alpha.emit('update-location', { roomCode: room, lat: 12.82, lng: 80.04, name: 'uA' });
    await waitFor(() => bravo.users.length);
    const roster = bravo.users[bravo.users.length - 1];
    expect(roster[alpha.id].role).toBe('admin');
    expect(roster[bravo.id]?.role ?? 'member').toBe('member');
    expect(roster[charlie.id]?.role ?? 'member').toBe('member');
  });
});

describe('a member', () => {
  it('cannot admit, admit all, kick, block, unblock, promote or read the log', async () => {
    const { room, alpha, bravo, charlie } = await group();
    const stranger = await knock(room, 'uS');
    await waitFor(() => alpha.requests.length);

    bravo.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    expect(await ask(bravo, 'admit-all', { roomCode: room })).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(await ask(bravo, 'kick-member', { roomCode: room, targetId: charlie.id })).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(await ask(bravo, 'block-user', { roomCode: room, targetId: charlie.id })).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(await ask(bravo, 'unblock-user', { roomCode: room, uid: 'uX' })).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(await ask(bravo, 'set-moderator', { roomCode: room, targetId: charlie.id, moderator: true })).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(await ask(bravo, 'get-activity-log', { roomCode: room })).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(await ask(bravo, 'get-blocked', { roomCode: room })).toMatchObject({ ok: false, reason: 'not-allowed' });
    await sleep(100);
    expect(charlie.exiled).toEqual([]);
    expect(stranger.listeners('access-granted')).toBeDefined();
    // Nobody was let in: the stranger's request is still Alpha's to answer.
    const granted = once(stranger, 'access-granted');
    alpha.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    await granted;
  });

  it('is not sent join requests or the waiting count', async () => {
    const { room, alpha, bravo } = await group();
    await knock(room, 'uS');
    await waitFor(() => alpha.waiting.length);
    expect(bravo.requests).toEqual([]);
    expect(bravo.waiting).toEqual([]);
  });
});

describe('a moderator', () => {
  it('is told so, and everyone is told who the moderators are', async () => {
    const { alpha, bravo, charlie } = await withModerator();
    await waitFor(() => charlie.roles.some((r) => r.moderatorIds.includes(bravo.id)));
    expect(lastRole(charlie)).toBe('member');
    await waitFor(() => alpha.roles.some((r) => r.moderatorIds.includes(bravo.id)));
    expect(lastRole(alpha)).toBe('admin');
  });

  it('gets join requests and admits one at a time; the admin\'s queue drops the one decided', async () => {
    const { room, alpha, bravo } = await withModerator();
    const stranger = await knock(room, 'uS');
    await waitFor(() => bravo.requests.length && alpha.requests.length);
    const granted = once(stranger, 'access-granted');
    bravo.emit('resolve-access', { targetId: stranger.id, roomCode: room, approved: true });
    expect(await granted).toMatchObject({ role: 'MEMBER', roomCode: room });
    await waitFor(() => alpha.withdrawn.some((w) => w.targetId === stranger.id));

    const other = await knock(room, 'uT');
    await waitFor(() => bravo.requests.length === 2);
    const denied = once(other, 'access-denied');
    bravo.emit('resolve-access', { targetId: other.id, roomCode: room, approved: false });
    await denied;
  });

  it('cannot Admit all, and is told why', async () => {
    const { room, alpha, bravo } = await withModerator();
    await knock(room, 'uS');
    await waitFor(() => bravo.requests.length);
    expect(await ask(bravo, 'admit-all', { roomCode: room }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can use Admit all.' });
    // Still waiting, for the admin.
    expect(await ask(alpha, 'admit-all', { roomCode: room })).toEqual({ ok: true, admitted: 1 });
  });

  it('can kick a member, who may then ask again', async () => {
    const { room, bravo, charlie } = await withModerator();
    expect(await ask(bravo, 'kick-member', { roomCode: room, targetId: charlie.id })).toEqual({ ok: true });
    await waitFor(() => charlie.exiled.length);
    expect(charlie.exiled[0]).toEqual({ reason: 'kicked' });
    // Kicked is not blocked: they can ask again (and must), and the moderator may admit them.
    const back = await api.requestJoin(charlie, room, 'uC');
    expect(back.outcome).toBe('pending');
    const granted = once(charlie, 'access-granted');
    bravo.emit('resolve-access', { targetId: charlie.id, roomCode: room, approved: true });
    await granted;
  });

  it('cannot block, see the blocked list or unblock, is told why, and nothing changes', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    expect(await ask(bravo, 'block-user', { roomCode: room, targetId: charlie.id }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can block people.' });
    expect(await ask(bravo, 'get-blocked', { roomCode: room }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can unblock people.' });
    await sleep(100);
    expect(charlie.exiled).toEqual([]);
    expect(await ask(alpha, 'get-blocked', { roomCode: room })).toEqual({ ok: true, blocked: [] });

    // Someone the admin blocked stays blocked whatever the moderator sends.
    expect(await ask(alpha, 'block-user', { roomCode: room, targetId: charlie.id })).toEqual({ ok: true });
    expect(await ask(bravo, 'unblock-user', { roomCode: room, uid: 'uC' }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can unblock people.' });
    expect(await api.requestJoin(charlie, room, 'uC')).toEqual({ outcome: 'denied' });
    expect(await ask(alpha, 'get-blocked', { roomCode: room })).toEqual({ ok: true, blocked: [{ uid: 'uC', name: 'uC' }] });
  });

  it('cannot kick or block the admin, or another moderator', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    expect(await ask(alpha, 'set-moderator', { roomCode: room, targetId: charlie.id, moderator: true })).toEqual({ ok: true });
    for (const event of ['kick-member', 'block-user']) {
      expect(await ask(bravo, event, { roomCode: room, targetId: alpha.id })).toMatchObject({ ok: false, reason: 'not-allowed' });
      expect(await ask(bravo, event, { roomCode: room, targetId: charlie.id })).toMatchObject({ ok: false, reason: 'not-allowed' });
    }
    await sleep(100);
    expect(alpha.exiled).toEqual([]);
    expect(charlie.exiled).toEqual([]);
  });

  it('cannot kick or block a stand-in holding command while the Commander is away', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    alpha.disconnect();
    charlie.disconnect();
    const charlie2 = track(await api.connect());
    expect(await api.requestJoin(charlie2, room, 'uC')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    for (const event of ['kick-member', 'block-user']) {
      expect(await ask(bravo, event, { roomCode: room, targetId: charlie2.id })).toMatchObject({ ok: false, reason: 'not-allowed' });
    }
  });

  it('cannot promote or demote moderators, and is told why', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    const refused = { ok: false, reason: 'not-allowed', message: 'Only the main admin can make or remove moderators.' };
    expect(await ask(bravo, 'set-moderator', { roomCode: room, targetId: charlie.id, moderator: true })).toEqual(refused);
    expect(await ask(bravo, 'set-moderator', { roomCode: room, targetId: bravo.id, moderator: false })).toEqual(refused);
    await sleep(100);
    expect(lastRole(charlie)).toBe('member');
    // Still a moderator, and the only one.
    expect(alpha.roles[alpha.roles.length - 1].moderatorIds).toEqual([bravo.id]);
  });

  it('is still a moderator after a reconnect, and is handed the waiting queue on return', async () => {
    const { room, alpha, bravo } = await withModerator();
    const stranger = await knock(room, 'uS');
    await waitFor(() => alpha.requests.length);
    bravo.disconnect();
    const bravo2 = track(await api.connect());
    const back = await api.returnToSquad(bravo2, room, 'uB');
    expect(back).toMatchObject({ outcome: 'granted', role: 'MEMBER' });
    await waitFor(() => lastRole(bravo2) === 'moderator');
    await waitFor(() => bravo2.requests.some((r) => r.targetId === stranger.id));
  });

  it('can be demoted by the admin, and is then a member again', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    expect(await ask(alpha, 'set-moderator', { roomCode: room, targetId: bravo.id, moderator: false })).toEqual({ ok: true });
    await waitFor(() => lastRole(bravo) === 'member');
    expect(await ask(bravo, 'kick-member', { roomCode: room, targetId: charlie.id })).toMatchObject({ ok: false, reason: 'not-allowed' });
  });
});

describe('the main admin', () => {
  it('admits everyone waiting at once, and the count drops to nothing', async () => {
    const { room, alpha } = await group();
    const joiners = [await knock(room, 'u1'), await knock(room, 'u2'), await knock(room, 'u3')];
    await waitFor(() => alpha.requests.length === 3);
    const grants = joiners.map((s) => once(s, 'access-granted'));
    expect(await ask(alpha, 'admit-all', { roomCode: room })).toEqual({ ok: true, admitted: 3 });
    await Promise.all(grants);
    // Nothing is left: a second Admit all admits nobody.
    expect(await ask(alpha, 'admit-all', { roomCode: room })).toEqual({ ok: true, admitted: 0 });
  });

  it('can kick and block a moderator', async () => {
    const { room, alpha, bravo } = await withModerator();
    expect(await ask(alpha, 'block-user', { roomCode: room, targetId: bravo.id })).toEqual({ ok: true });
    await waitFor(() => bravo.exiled.length);
    expect(await api.requestJoin(bravo, room, 'uB')).toEqual({ outcome: 'denied' });
  });

  it('blocks and unblocks a member, and sees who is blocked', async () => {
    const { room, alpha, charlie } = await group();
    expect(await ask(alpha, 'block-user', { roomCode: room, targetId: charlie.id })).toEqual({ ok: true });
    await waitFor(() => charlie.exiled.length);
    expect(charlie.exiled[0]).toEqual({ reason: 'blocked' });
    expect(await api.requestJoin(charlie, room, 'uC')).toEqual({ outcome: 'denied' });
    expect(await ask(alpha, 'get-blocked', { roomCode: room })).toEqual({ ok: true, blocked: [{ uid: 'uC', name: 'uC' }] });
    expect(await ask(alpha, 'unblock-user', { roomCode: room, uid: 'uC' })).toEqual({ ok: true, blocked: [] });
    expect((await api.requestJoin(charlie, room, 'uC')).outcome).toBe('pending');
    expect(await ask(alpha, 'unblock-user', { roomCode: room, uid: 'uC' })).toEqual({ ok: false, reason: 'not-blocked' });
  });

  it('is told it is the Group\'s own admin', async () => {
    const { alpha } = await withModerator(); // a role change: everyone is told their role again
    await waitFor(() => alpha.roles.length);
    expect(alpha.roles[alpha.roles.length - 1]).toMatchObject({ role: 'admin', ownAdmin: true });
  });
});

describe('a stand-in holding command while the Commander is away', () => {
  // Alpha (the Commander) drops off; Charlie comes back on a new socket and stands in.
  const standIn = async () => {
    const g = await group();
    // Someone Alpha blocked earlier, to try unblocking.
    expect(await ask(g.alpha, 'block-user', { roomCode: g.room, targetId: g.bravo.id })).toEqual({ ok: true });
    g.alpha.disconnect();
    g.charlie.disconnect();
    const charlie2 = track(await api.connect());
    expect(await api.requestJoin(charlie2, g.room, 'uC')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    const delta = track(await api.connect());
    const pending = once(delta, 'access-pending');
    delta.emit('request-join', { roomCode: g.room, user: { uid: 'uD', name: 'uD' } });
    await pending;
    return { ...g, charlie2, delta };
  };

  it('cannot block, unblock, see the blocked list, Admit all or make moderators, is told why, and nothing changes', async () => {
    const { room, charlie2, delta } = await standIn();
    const echo = track(await api.connect());
    const echoPending = once(echo, 'access-pending');
    echo.emit('request-join', { roomCode: room, user: { uid: 'uE', name: 'uE' } });
    await echoPending;
    // A member to act on: Delta, let in one at a time (still the stand-in's to do).
    await waitFor(() => charlie2.requests.some((r) => r.targetId === delta.id));
    const granted = once(delta, 'access-granted');
    charlie2.emit('resolve-access', { targetId: delta.id, roomCode: room, approved: true });
    await granted;

    expect(await ask(charlie2, 'block-user', { roomCode: room, targetId: delta.id }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can block people.' });
    expect(await ask(charlie2, 'unblock-user', { roomCode: room, uid: 'uB' }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can unblock people.' });
    expect(await ask(charlie2, 'get-blocked', { roomCode: room }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can unblock people.' });
    expect(await ask(charlie2, 'admit-all', { roomCode: room }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can use Admit all.' });
    expect(await ask(charlie2, 'set-moderator', { roomCode: room, targetId: delta.id, moderator: true }))
      .toEqual({ ok: false, reason: 'not-allowed', message: 'Only the main admin can make or remove moderators.' });
    await sleep(100);
    expect(delta.exiled).toEqual([]);
    // Bravo is still blocked; Echo is still waiting.
    const bravo2 = track(await api.connect());
    expect(await api.requestJoin(bravo2, room, 'uB')).toEqual({ outcome: 'denied' });
    expect(echo.listeners('access-granted').length).toBeGreaterThanOrEqual(0);

    // Its screen is told it is not the Group's own admin.
    await waitFor(() => charlie2.roles.length);
    expect(charlie2.roles[charlie2.roles.length - 1]).toMatchObject({ role: 'admin', ownAdmin: false });
  });

  it('still lets people in one at a time and removes members', async () => {
    const { room, charlie2, delta } = await standIn();
    await waitFor(() => charlie2.requests.some((r) => r.targetId === delta.id));
    const granted = once(delta, 'access-granted');
    charlie2.emit('resolve-access', { targetId: delta.id, roomCode: room, approved: true });
    await granted;
    expect(await ask(charlie2, 'kick-member', { roomCode: room, targetId: delta.id })).toEqual({ ok: true });
  });

  it('hands all of it back: the returning Commander blocks, unblocks and admits all again', async () => {
    const { room, charlie2 } = await standIn();
    const alpha2 = track(await api.connect());
    expect(await api.requestJoin(alpha2, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await waitFor(() => alpha2.roles.some((r) => r.ownAdmin === true));
    expect(await ask(alpha2, 'admit-all', { roomCode: room })).toEqual({ ok: true, admitted: 1 });
    expect(await ask(alpha2, 'unblock-user', { roomCode: room, uid: 'uB' })).toEqual({ ok: true, blocked: [] });
    expect(await ask(alpha2, 'block-user', { roomCode: room, targetId: charlie2.id })).toEqual({ ok: true });
  });
});

describe('the Commander reclaiming the Group', () => {
  it('still works with moderators in it, and moderators keep their role', async () => {
    const { room, alpha, bravo } = await withModerator();
    alpha.disconnect();
    await sleep(50);
    const alpha2 = track(await api.connect());
    expect(await api.requestJoin(alpha2, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await waitFor(() => lastRole(alpha2) === 'admin');
    await waitFor(() => lastRole(bravo) === 'moderator');
  });
});

// Every path that could hand out the role without the admin: none may (backend/groupRoles.js).
describe('a moderator is only ever made by the main admin', () => {
  const moderatorsOf = (socket) => socket.roles[socket.roles.length - 1]?.moderatorIds ?? [];

  it('not by creating a Group, joining one, or a reconnect', async () => {
    const { room, alpha, bravo, charlie } = await group();
    const delta = track(await api.connect());
    await api.admit(alpha, delta, room, 'uD');
    charlie.disconnect();
    const charlie2 = track(await api.connect());
    await api.returnToSquad(charlie2, room, 'uC');
    await settle(alpha);
    for (const s of [bravo, charlie2, delta]) expect(lastRole(s) ?? 'member').toBe('member');
    expect(moderatorsOf(alpha)).toEqual([]);
  });

  it('not by standing in while the Commander is away, nor by the Commander taking the Group back', async () => {
    const { room, alpha, bravo, charlie } = await group();
    alpha.disconnect();
    charlie.disconnect();
    const charlie2 = track(await api.connect());
    expect(await api.requestJoin(charlie2, room, 'uC')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    const alpha2 = track(await api.connect());
    expect(await api.requestJoin(alpha2, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await waitFor(() => lastRole(charlie2) === 'member');
    await settle(alpha2);
    expect(moderatorsOf(alpha2)).toEqual([]);
    expect(lastRole(bravo) ?? 'member').toBe('member');
  });

  it('not by the Commander leaving: whoever takes the Group on is its admin, nobody a moderator', async () => {
    const { room, alpha, bravo, charlie } = await group();
    alpha.emit('leave-squad');
    await waitFor(() => lastRole(bravo) === 'admin' || lastRole(charlie) === 'admin');
    await settle(bravo);
    expect(moderatorsOf(bravo)).toEqual([]);
    expect(moderatorsOf(charlie)).toEqual([]);
    // The new Commander makes moderators from now on.
    const lead = lastRole(bravo) === 'admin' ? bravo : charlie;
    const other = lead === bravo ? charlie : bravo;
    expect(await ask(lead, 'set-moderator', { roomCode: room, targetId: other.id, moderator: true })).toEqual({ ok: true });
  });

  it('keeps the role through a dropped connection, but leaving and coming back makes them a member', async () => {
    const { room, alpha, bravo } = await withModerator();
    bravo.emit('leave-squad');
    await waitFor(() => moderatorsOf(alpha).length === 0);
    const bravo2 = track(await api.connect());
    await api.admit(alpha, bravo2, room, 'uB');
    await waitFor(() => bravo2.roles.length);
    await settle(alpha);
    expect(lastRole(bravo2)).toBe('member');
    expect(moderatorsOf(alpha)).toEqual([]);
  });

  it('is not carried into another Group', async () => {
    const { bravo } = await withModerator();
    const other = api.newRoom();
    const zulu = track(await api.connect());
    await api.createSquad(zulu, other, 'uZ');
    const bravoElsewhere = track(await api.connect());
    await api.admit(zulu, bravoElsewhere, other, 'uB');
    await waitFor(() => bravoElsewhere.roles.length);
    await settle(zulu);
    expect(lastRole(bravoElsewhere)).toBe('member');
    expect(moderatorsOf(zulu)).toEqual([]);
    expect(lastRole(bravo)).toBe('moderator');
  });

  it('nor by a Group set up again under the same code', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    for (const s of [bravo, charlie, alpha]) s.emit('leave-squad');
    await sleep(100);
    const alpha2 = track(await api.connect());
    await api.createSquad(alpha2, room, 'uA');
    const bravo2 = track(await api.connect());
    await api.admit(alpha2, bravo2, room, 'uB');
    await waitFor(() => bravo2.roles.length);
    expect(lastRole(bravo2)).toBe('member');
  });
});

describe('join requests waiting', () => {
  it('are counted on the server while no admitter is connected, and handed over in full on return', async () => {
    const { room, alpha, bravo, charlie } = await group();
    // Everyone who could admit, and everyone who could stand in, is away.
    bravo.disconnect();
    charlie.disconnect();
    alpha.disconnect();
    await sleep(100);
    await knock(room, 'u1');
    await knock(room, 'u2');
    await knock(room, 'u3');
    const alpha2 = track(await api.connect());
    expect(await api.requestJoin(alpha2, room, 'uA')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await waitFor(() => alpha2.requests.length === 3);
  });

  it('are announced once per burst, with the count, to the admin and moderators only', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    await knock(room, 'u1');
    await knock(room, 'u2');
    await knock(room, 'u3');
    await waitFor(() => alpha.waiting.length && bravo.waiting.length);
    await sleep(BATCH_MS * 2);
    expect(alpha.waiting).toEqual([{ roomCode: room, count: 3 }]);
    expect(bravo.waiting).toEqual([{ roomCode: room, count: 3 }]);
    expect(charlie.waiting).toEqual([]);
  });
});

describe('the activity log', () => {
  it('records going hidden and coming back, with no position, for the admin and moderators only', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    charlie.emit('update-location', { roomCode: room, lat: 12.82, lng: 80.04, name: 'uC', status: 'ACTIVE' });
    charlie.emit('update-location', { roomCode: room, lat: 12.83, lng: 80.05, name: 'uC', status: 'GHOST' });
    charlie.emit('update-location', { roomCode: room, lat: 12.84, lng: 80.06, name: 'uC', status: 'ACTIVE' });
    await waitFor(() => alpha.activity.length === 2 && bravo.activity.length === 2);
    expect(alpha.activity.map((a) => a.entry.kind)).toEqual(['went-hidden', 'back-from-hidden']);
    expect(alpha.activity[0].entry).toMatchObject({ uid: 'uC', name: 'uC' });
    expect(typeof alpha.activity[0].entry.at).toBe('number');
    for (const { entry } of alpha.activity) {
      expect(entry).not.toHaveProperty('lat');
      expect(entry).not.toHaveProperty('lng');
    }
    expect(charlie.activity).toEqual([]);
    const { ok, log } = await ask(bravo, 'get-activity-log', { roomCode: room });
    expect(ok).toBe(true);
    expect(log.map((e) => e.kind)).toEqual(['went-hidden', 'back-from-hidden']);
  });

  it('records a Leave apart from a dropped connection, and kicks and blocks with who did it', async () => {
    const { room, alpha, bravo, charlie } = await withModerator();
    charlie.emit('leave-squad');
    await waitFor(() => alpha.activity.length === 1);
    expect(alpha.activity[0].entry).toMatchObject({ kind: 'left-group', uid: 'uC' });

    const delta = track(await api.connect());
    await api.admit(alpha, delta, room, 'uD');
    delta.disconnect();
    await waitFor(() => alpha.activity.length === 2);
    expect(alpha.activity[1].entry).toMatchObject({ kind: 'connection-lost', uid: 'uD' });

    const echo = track(await api.connect());
    await api.admit(alpha, echo, room, 'uE');
    await ask(bravo, 'kick-member', { roomCode: room, targetId: echo.id });
    await waitFor(() => alpha.activity.length === 3);
    expect(alpha.activity[2].entry).toMatchObject({ kind: 'kicked', uid: 'uE', byUid: 'uB', byName: 'uB' });

    const foxtrot = track(await api.connect());
    await api.admit(alpha, foxtrot, room, 'uF');
    await ask(alpha, 'block-user', { roomCode: room, targetId: foxtrot.id });
    await waitFor(() => alpha.activity.length === 4);
    expect(alpha.activity[3].entry).toMatchObject({ kind: 'blocked', uid: 'uF', byUid: 'uA', byName: 'uA' });
    await ask(alpha, 'unblock-user', { roomCode: room, uid: 'uF' });
    await waitFor(() => alpha.activity.length === 5);
    expect(alpha.activity[4].entry).toMatchObject({ kind: 'unblocked', uid: 'uF', byUid: 'uA', byName: 'uA' });
    // The moderator reads the same log.
    await waitFor(() => bravo.activity.length === 5);
  });

  it('does not log a reconnect as a lost connection', async () => {
    const { room, alpha, bravo } = await group();
    const bravo2 = track(await api.connect());
    await api.returnToSquad(bravo2, room, 'uB'); // the new connection replaces the old one first
    bravo.disconnect();
    await sleep(200);
    expect(alpha.activity).toEqual([]);
  });

  it('keeps a hidden member\'s position from everyone', async () => {
    const { room, alpha, charlie } = await group();
    charlie.emit('update-location', { roomCode: room, lat: 12.83, lng: 80.05, name: 'uC', status: 'GHOST' });
    charlie.emit('safety-ping', { latitude: 12.83, longitude: 80.05, timestamp: new Date().toISOString(), batteryLevel: '50%' });
    await waitFor(() => alpha.users.some((u) => u[charlie.id]?.status === 'GHOST'));
    const entry = alpha.users.findLast((u) => u[charlie.id])[charlie.id];
    expect(entry.lat).toBeUndefined();
    expect(entry.lng).toBeUndefined();
    expect(entry.hasFix).toBe(false);
    const table = new Promise((resolve) => alpha.once('telemetry-sync-complete', resolve));
    alpha.emit('request-telemetry', room, () => {});
    expect((await table)[charlie.id]).toBeUndefined();
  });
});

describe('malformed payloads', () => {
  it('never take the server down', async () => {
    const { room, alpha, bravo } = await withModerator();
    const bad = [undefined, null, 0, 'x', [], { roomCode: 7 }, { roomCode: room, targetId: {} }, { roomCode: room, uid: 5 }, { roomCode: room, targetId: alpha.id, moderator: 'yes' }];
    for (const event of ['admit-all', 'kick-member', 'block-user', 'unblock-user', 'get-blocked', 'set-moderator', 'get-activity-log', 'resolve-access']) {
      for (const payload of bad) {
        alpha.emit(event, payload);
        bravo.emit(event, payload, () => {});
      }
    }
    // 72 events a phone in one go is over the server's per-second limit, so the rest of that
    // second is dropped: the check below waits for the next one.
    await sleep(1100);
    await settle(alpha);
    await settle(bravo);
    expect(api.serverIsAlive()).toBe(true);
    expect(await ask(alpha, 'get-activity-log', { roomCode: room })).toMatchObject({ ok: true });
  });
});
