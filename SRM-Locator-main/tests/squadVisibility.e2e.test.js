import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, once, settle } from './helpers/e2eServer.js';

/**
 * Who a squad can actually see, end to end: the real server, real sockets, the real
 * join flow.
 *
 * The client keys squad members — markers, roster rows, ghosts — off whatever id this
 * roster payload arrives under. A socket id lives exactly as long as one connection, and
 * on mobile that is a matter of minutes, so a roster built only out of socket ids left two
 * marks on the map for one reconnecting person and a "signal lost" ghost that could never
 * be cleared, because nothing on the wire said the returning node was the same human.
 * These tests pin the roster's contract: stable identity on every entry, exactly one entry
 * per person, and everyone on the roster present whether or not they have a fix.
 */

const { connect, createSquad, admit, squadOfThree, newRoom } = e2eServer();

// Collect every roster this socket is sent; the returned reader gives the latest one.
const watchRoster = (socket) => {
  socket.rosters = [];
  socket.on('users-update', (payload) => socket.rosters.push(payload));
  return () => socket.rosters[socket.rosters.length - 1] || {};
};

const watchLost = (socket) => {
  socket.lost = [];
  socket.on('member-signal-lost', (payload) => socket.lost.push(payload));
  return socket.lost;
};

const sendFix = (socket, room, name, lat, lng) =>
  socket.emit('update-location', {
    name, lat, lng, speed: 0, battery: 90, status: 'ACTIVE', roomCode: room, heading: 0,
  });

const returnAs = async (socket, room, uid) => {
  socket.emit('request-join', { roomCode: room, user: { uid, name: uid } });
  return once(socket, 'access-granted');
};

const uidsIn = (roster) => Object.values(roster).map((u) => u.uid).sort();
const entriesFor = (roster, uid) => Object.values(roster).filter((u) => u.uid === uid);

describe('the roster everyone renders from', () => {
  it('tags every member with their stable uid, not just a socket id', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const roster = watchRoster(charlie);

    sendFix(alpha, room, 'uA', 12.82, 80.04);
    sendFix(bravo, room, 'uB', 12.821, 80.041);
    await waitFor(() => Object.keys(roster()).length === 3);

    expect(uidsIn(roster())).toEqual(['uA', 'uB', 'uC']);
  });

  it('lists a member who has no GPS fix yet, so they degrade instead of vanishing', async () => {
    const room = newRoom();
    const alpha = await connect();
    const bravo = await connect();
    await createSquad(alpha, room, 'uA');
    const roster = watchRoster(alpha);

    // Bravo is admitted but never reports a position — indoors, location permission
    // denied, or simply no lock yet. They are a squad member either way.
    await admit(alpha, bravo, room, 'uB');
    await waitFor(() => Object.keys(roster()).length === 2);

    const entries = Object.values(roster());
    expect(entries.map((u) => u.uid).sort()).toEqual(['uA', 'uB']);
    expect(entries.every((u) => u.hasFix === false)).toBe(true);

    // ...and flips to hasFix once a real coordinate lands, which is what gates the marker.
    sendFix(bravo, room, 'uB', 12.83, 80.05);
    await waitFor(() => Object.values(roster()).some((u) => u.hasFix));
    expect(entriesFor(roster(), 'uB')[0]).toMatchObject({ hasFix: true, lat: 12.83, lng: 80.05 });
  });

  it('shows a mid-session joiner to the whole squad on approval, before any telemetry', async () => {
    const { room, alpha, charlie } = await squadOfThree();
    const roster = watchRoster(charlie);
    sendFix(alpha, room, 'uA', 12.82, 80.04);
    await waitFor(() => Object.keys(roster()).length >= 3);

    const delta = await connect();
    await admit(alpha, delta, room, 'uD');

    await waitFor(() => entriesFor(roster(), 'uD').length === 1);
    expect(uidsIn(roster())).toEqual(['uA', 'uB', 'uC', 'uD']);
  });
});

describe('a member coming back on a new socket', () => {
  it('is one node on the roster, not two — for a plain member', async () => {
    const { room, bravo, charlie } = await squadOfThree();
    const roster = watchRoster(charlie);
    sendFix(bravo, room, 'uB', 12.821, 80.041);
    await waitFor(() => entriesFor(roster(), 'uB').length === 1);
    const staleId = bravo.id;

    const bravo2 = await connect(); // old socket still connected: the half-open mobile case
    await returnAs(bravo2, room, 'uB');
    sendFix(bravo2, room, 'uB', 12.822, 80.042);

    await waitFor(() => Object.keys(roster()).includes(bravo2.id));
    expect(entriesFor(roster(), 'uB')).toHaveLength(1);
    expect(Object.keys(roster())).not.toContain(staleId);
  });

  it('is one node on the roster, not two — for the Commander', async () => {
    // The owner-reconnect path used to skip the teardown the member path did: the old
    // socket kept its telemetry and its room subscription, so the Commander showed up
    // twice on every other client's map, once live and once frozen.
    const { room, alpha, charlie } = await squadOfThree();
    const roster = watchRoster(charlie);
    sendFix(alpha, room, 'uA', 12.82, 80.04);
    await waitFor(() => entriesFor(roster(), 'uA').length === 1);
    const staleOwnerId = alpha.id;

    const alpha2 = await connect(); // old owner socket still connected
    const granted = await returnAs(alpha2, room, 'uA');
    expect(granted.role).toBe('OWNER');
    sendFix(alpha2, room, 'uA', 12.825, 80.045);

    await waitFor(() => Object.keys(roster()).includes(alpha2.id));
    expect(entriesFor(roster(), 'uA')).toHaveLength(1);
    expect(Object.keys(roster())).not.toContain(staleOwnerId);
  });

  it('leaves no "signal lost" ghost behind when the superseded socket finally dies', async () => {
    const { room, alpha, charlie } = await squadOfThree();
    const roster = watchRoster(charlie);
    const lost = watchLost(charlie);
    sendFix(alpha, room, 'uA', 12.82, 80.04);
    await waitFor(() => entriesFor(roster(), 'uA').length === 1);

    const alpha2 = await connect();
    await returnAs(alpha2, room, 'uA');
    sendFix(alpha2, room, 'uA', 12.825, 80.045);
    await settle(alpha2);

    await settle(alpha);
    alpha.disconnect(); // the superseded connection times out at last
    await sleep(400);

    expect(lost).toEqual([]);
    expect(entriesFor(roster(), 'uA')).toHaveLength(1);
  });

  it('stops delivering the squad roster to the superseded socket', async () => {
    const { room, alpha, charlie } = await squadOfThree();
    watchRoster(alpha);
    const alpha2 = await connect();
    await returnAs(alpha2, room, 'uA');
    await settle(alpha2);

    const seenBefore = alpha.rosters.length;
    sendFix(charlie, room, 'uC', 12.83, 80.05);
    await sleep(400);
    expect(alpha.rosters.length).toBe(seenBefore);
  });
});

describe('a member who genuinely drops', () => {
  it('raises a signal-lost carrying their uid, and comes off the roster', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const roster = watchRoster(charlie);
    const lost = watchLost(charlie);
    sendFix(alpha, room, 'uA', 12.82, 80.04);
    sendFix(bravo, room, 'uB', 12.821, 80.041);
    await waitFor(() => Object.values(roster()).filter((u) => u.hasFix).length === 2);

    await settle(bravo);
    bravo.disconnect();

    await waitFor(() => lost.length === 1);
    expect(lost[0]).toMatchObject({ uid: 'uB' });
    await waitFor(() => entriesFor(roster(), 'uB').length === 0);
  });
});
