// An Emergency alert sent while offline reaches the group once the phone is back (a fix,
// 2026-10-07). The real backend/server.js, real Socket.IO clients, and a sender that
// reconnects the way App.jsx does: socket.io reconnects by itself, and on every 'connect'
// the app asks to rejoin; on 'access-granted' it tells the outbox it is back in the group.
//
// Before the fix the alert went into socket.io's own buffer, which is sent on reconnect
// before the rejoin, from a connection the server doesn't know yet: it was dropped.
import { describe, it, expect } from 'vitest';
import { io } from 'socket.io-client';
import { e2eServer, sleep, waitFor, once } from './helpers/e2eServer.js';
import { createSosOutbox } from '../src/utils/sosOutbox.js';

const { connect, createSquad, newRoom } = e2eServer();

const alertFrom = (lat = 12.8231, lng = 80.0442) => ({ senderName: 'Bravo', lat, lng, roomCode: null, timestamp: Date.now() });

// Bravo, approved into Alpha's group, wired like App.jsx.
const groupWithBravo = async () => {
  const room = newRoom();
  const alpha = await connect();
  await createSquad(alpha, room, 'uA');
  const url = alpha.io.uri;
  const bravo = io(url, { transports: ['websocket'], forceNew: true, reconnectionDelay: 50, reconnectionDelayMax: 100 });
  const outbox = createSosOutbox(bravo);
  bravo.on('connect', () => bravo.emit('request-join', { roomCode: room, user: { uid: 'uB', name: 'Bravo' } }));
  bravo.on('access-granted', () => outbox.markInGroup());
  const request = once(alpha, 'access-request');
  const { targetId } = await request;
  alpha.emit('resolve-access', { targetId, roomCode: room, approved: true });
  await waitFor(() => outbox.canSend());
  const send = (lat, lng) => outbox.send({ ...alertFrom(lat, lng), roomCode: room });
  // The network drops (not a deliberate disconnect): socket.io reconnects on its own.
  const dropNetwork = async () => {
    bravo.io.engine.close();
    await waitFor(() => !bravo.connected);
  };
  return { room, alpha, bravo, outbox, send, dropNetwork, cleanup: () => { outbox.dispose(); bravo.disconnect(); } };
};

describe('an alert sent while offline', { timeout: 15000 }, () => {
  it('reaches the group once the phone is back in it', async () => {
    const g = await groupWithBravo();
    await g.dropNetwork();
    const sentAtOnce = g.send();
    await waitFor(() => g.alpha.sos.length === 1, { timeout: 5000 });
    expect(sentAtOnce).toBe(false); // held, not sent, while offline
    expect(g.alpha.sos[0]).toMatchObject({ senderName: 'Bravo', lat: 12.8231, lng: 80.0442 });
    await sleep(300);
    expect(g.alpha.sos).toHaveLength(1);
    g.cleanup();
  });

  it('is sent once, with the freshest location, however often the button is used while held', async () => {
    const g = await groupWithBravo();
    await g.dropNetwork();
    g.send(12.1, 80.1);
    g.send(12.2, 80.2);
    g.send(null, null); // a press with no fix keeps the last location
    await waitFor(() => g.alpha.sos.length === 1, { timeout: 5000 });
    await sleep(300);
    expect(g.alpha.sos).toHaveLength(1);
    expect(g.alpha.sos[0]).toMatchObject({ lat: 12.2, lng: 80.2 });
    g.cleanup();
  });

  it('survives a second drop before it is delivered', async () => {
    const g = await groupWithBravo();
    await g.dropNetwork();
    g.send();
    // Back on the network, but dropped again before the server lets it back in.
    await waitFor(() => g.bravo.connected, { timeout: 5000 });
    g.bravo.io.engine.close();
    await waitFor(() => g.alpha.sos.length === 1, { timeout: 5000 });
    await sleep(300);
    expect(g.alpha.sos).toHaveLength(1);
    g.cleanup();
  });
});

describe('an alert sent online', () => {
  it('goes out at once, as before', async () => {
    const g = await groupWithBravo();
    expect(g.send()).toBe(true);
    await waitFor(() => g.alpha.sos.length === 1);
    g.cleanup();
  });
});
