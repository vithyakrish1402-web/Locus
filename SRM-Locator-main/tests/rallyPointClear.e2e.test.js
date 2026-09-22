import { describe, it, expect } from 'vitest';
import { e2eServer, sleep, waitFor, once, settle } from './helpers/e2eServer.js';

/**
 * Clearing a Rally Point, end to end: the real server, real sockets.
 *
 * Any member can drop a Rally Point (the targeting FAB is on every phone, and choosing a
 * building destination publishes one too), but only the Commander could clear one, so
 * an operative's own Rally Point stayed on everyone's map until the Commander noticed.
 * And the server only ever told a (re)admitted member about a Rally Point that existed:
 * one who was offline when it was cleared came back to it still on their map, with
 * nothing that could remove it.
 */

const { connect, createSquad, admit, requestJoin, squadOfThree, newRoom } = e2eServer();

const RALLY = { lat: 12.8231, lng: 80.0442, name: 'RALLY POINT' };

// Every Rally Point event a socket receives from here on, in order.
const watchRally = (socket) => {
  const events = [];
  socket.on('new-waypoint', (wp) => events.push({ event: 'new-waypoint', wp }));
  socket.on('remove-waypoint', () => events.push({ event: 'remove-waypoint' }));
  return events;
};

const deploy = async (socket, room, waypoint = RALLY) => {
  const echoed = once(socket, 'new-waypoint');
  socket.emit('publish-waypoint', { roomCode: room, waypoint });
  return echoed;
};

describe('who can clear a Rally Point', () => {
  it('the member who dropped it, and it goes from every map in the squad', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    await deploy(bravo, room);
    const seen = [alpha, bravo, charlie].map(watchRally);

    bravo.emit('clear-waypoint', room);
    await waitFor(() => seen.every((events) => events.some((e) => e.event === 'remove-waypoint')));
  });

  it('the Commander, whoever dropped it', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    await deploy(bravo, room);
    const seen = [alpha, bravo, charlie].map(watchRally);

    alpha.emit('clear-waypoint', room);
    await waitFor(() => seen.every((events) => events.some((e) => e.event === 'remove-waypoint')));
  });

  it('not another member, whose Rally Point it isn\'t', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    await deploy(bravo, room);
    const seen = [alpha, bravo, charlie].map(watchRally);

    charlie.emit('clear-waypoint', room);
    await settle(charlie);
    await sleep(150);
    expect(seen.flat()).toEqual([]);

    // ...nor a member once someone else has replaced theirs.
    await deploy(alpha, room, { ...RALLY, lat: 12.83 });
    seen.forEach((events) => events.splice(0));
    bravo.emit('clear-waypoint', room);
    await settle(bravo);
    await sleep(150);
    expect(seen.flat()).toEqual([]);
  });

  it('not anyone outside the squad', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    await deploy(alpha, room);
    const seen = [alpha, bravo].map(watchRally);

    const outsider = await connect();
    outsider.emit('clear-waypoint', room);
    await settle(outsider);
    await sleep(150);
    expect(seen.flat()).toEqual([]);
  });

  it('the member who dropped it, still, after they reconnect on a new socket', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    await deploy(bravo, room);
    bravo.disconnect();
    const bravo2 = await connect();
    await requestJoin(bravo2, room, 'uB');

    const seen = watchRally(alpha);
    bravo2.emit('clear-waypoint', room);
    await waitFor(() => seen.some((e) => e.event === 'remove-waypoint'));
  });
});

describe('who dropped it', () => {
  it('is recorded by the server and sent with it, not taken from the client', async () => {
    const { room, alpha, bravo, charlie } = await squadOfThree();
    const onCharlie = once(charlie, 'new-waypoint');
    bravo.emit('publish-waypoint', { roomCode: room, waypoint: { ...RALLY, setBy: 'uC' } }); // claims to be Charlie's
    expect(await onCharlie).toEqual({ ...RALLY, setBy: 'uB' });

    // So Charlie can't clear it on the strength of Bravo's claim.
    const seen = watchRally(alpha);
    charlie.emit('clear-waypoint', room);
    await settle(charlie);
    await sleep(150);
    expect(seen).toEqual([]);
  });
});

describe('every member ends up agreeing on the Rally Point', () => {
  it('a member who was offline when it was cleared is told on their way back in', async () => {
    const { room, alpha, bravo } = await squadOfThree();
    await deploy(alpha, room);
    bravo.disconnect();
    alpha.emit('clear-waypoint', room);
    await settle(alpha);

    const bravo2 = await connect();
    const seen = watchRally(bravo2);
    await requestJoin(bravo2, room, 'uB');
    await waitFor(() => seen.length);
    expect(seen).toEqual([{ event: 'remove-waypoint' }]);
  });

  it('a newly approved member is told there is none, clearing anything left from a previous squad', async () => {
    const room = newRoom();
    const [owner, joiner] = [await connect(), await connect()];
    await createSquad(owner, room, 'uO');

    const seen = watchRally(joiner);
    await admit(owner, joiner, room, 'uJ');
    await waitFor(() => seen.length);
    expect(seen).toEqual([{ event: 'remove-waypoint' }]);
  });

  it('a member who takes over as caretaker Commander gets the current one', async () => {
    const { room, alpha, charlie } = await squadOfThree();
    await deploy(alpha, room);
    alpha.disconnect(); // the Commander is gone, not just blipping
    charlie.disconnect();

    const charlie2 = await connect();
    const seen = watchRally(charlie2);
    expect(await requestJoin(charlie2, room, 'uC')).toMatchObject({ outcome: 'granted', role: 'OWNER' });
    await waitFor(() => seen.length);
    expect(seen).toEqual([{ event: 'new-waypoint', wp: { ...RALLY, setBy: 'uA' } }]);
  });
});
