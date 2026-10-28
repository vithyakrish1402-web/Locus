// What this phone saves up to send while it has no connection (a fix, 2026-10-28).
//
// socket.io keeps every emit made while disconnected and sends them all, at once, the moment it
// reconnects. An hour in a dead zone was thousands of packets (a position every second, a latency
// probe every two) held in memory, then flushed in one burst ahead of the rejoin, where the
// server dropped them. Positions and probes now go volatile (dropped while offline: the next one
// is fresh anyway), and what is still saved up is kept in hand here:
// - at most QUEUE_MAX_ITEMS, oldest dropped first;
// - nothing older than QUEUE_MAX_AGE_MS;
// - anything about an SOS never dropped, whatever its age or the queue's size;
// - sent RECONNECT_BATCH_SIZE at a time once back, one batch a second, after the rejoin has had
//   a moment to land (the server takes 30 events a second from a connection).

export const QUEUE_MAX_ITEMS = 200;
export const QUEUE_MAX_AGE_MS = 60000;
export const RECONNECT_BATCH_SIZE = 20;
export const RECONNECT_BATCH_GAP_MS = 1000;

const KEEP = new Set(['sos-broadcast', 'sos-ack', 'sos-sync']);
const eventOf = (packet) => packet?.data?.[0];

/** The packets worth sending still, in order: none stale (unless kept), at most `maxItems`. */
export function trimQueue(packets, now, { maxItems = QUEUE_MAX_ITEMS, maxAgeMs = QUEUE_MAX_AGE_MS } = {}) {
  const fresh = packets.filter((p) => KEEP.has(eventOf(p)) || now - (p.queuedAt ?? now) <= maxAgeMs);
  let over = fresh.length - maxItems;
  if (over <= 0) return fresh;
  return fresh.filter((p) => {
    if (over > 0 && !KEEP.has(eventOf(p))) {
      over -= 1;
      return false;
    }
    return true;
  });
}

/**
 * Keeps `socket`'s saved-up packets in hand (see above). Returns a function that stops it.
 * @param {{ sendBuffer: object[], packet: Function, connected: boolean, on: Function, off: Function, io: { on: Function, off: Function } }} socket
 */
export function manageSendQueue(socket, { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, setTick = setInterval, clearTick = clearInterval } = {}) {
  let inHand = [];
  let batchTimer = null;

  // Each saved-up packet stamped with when it was queued (checked once a second), and the queue
  // kept within its limits while offline.
  const tick = setTick(() => {
    if (socket.connected || !socket.sendBuffer?.length) return;
    const at = now();
    socket.sendBuffer.forEach((p) => { p.queuedAt ??= at; });
    socket.sendBuffer = trimQueue(socket.sendBuffer, at);
  }, 1000);

  // The connection is open again, and socket.io is about to send everything it saved up: taken
  // into hand instead, to go out in batches.
  const onOpen = () => {
    if (!socket.sendBuffer?.length) return;
    const at = now();
    socket.sendBuffer.forEach((p) => { p.queuedAt ??= at; });
    inHand = trimQueue([...inHand, ...socket.sendBuffer], at);
    socket.sendBuffer = [];
  };
  const sendBatch = () => {
    batchTimer = null;
    if (!socket.connected || !inHand.length) return;
    inHand = trimQueue(inHand, now());
    inHand.splice(0, RECONNECT_BATCH_SIZE).forEach((p) => socket.packet(p));
    if (inHand.length) batchTimer = setTimer(sendBatch, RECONNECT_BATCH_GAP_MS);
  };
  const onConnect = () => {
    if (inHand.length && batchTimer === null) batchTimer = setTimer(sendBatch, RECONNECT_BATCH_GAP_MS);
  };
  const onDisconnect = () => {
    if (batchTimer !== null) clearTimer(batchTimer);
    batchTimer = null;
  };

  socket.io.on('open', onOpen);
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  return () => {
    clearTick(tick);
    onDisconnect();
    socket.io.off('open', onOpen);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
  };
}
