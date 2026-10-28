import { useCallback, useEffect, useRef, useState } from 'react';

// An older server doesn't send an id; fall back to something stable enough to dedupe. Each
// beacon is also stamped with when it reached THIS phone, on this phone's clock, so its age can
// keep counting here (the server's ageMs, plus the time since) without mixing two clocks.
const withId = (sos) => ({ ...sos, id: sos.id ?? `${sos.senderId}:${sos.timestamp}`, receivedAt: Date.now() });

/**
 * Incoming squad-wide SOS beacons, as a queue the overlay works through one at a time.
 *
 *  - A live beacon and its later replay (see requestSync) are the same beacon: matched
 *    by id, held once.
 *  - The same sender holding the button again supersedes their earlier, still
 *    unacknowledged beacon in place rather than stacking behind it.
 *  - Different senders queue up in arrival order — a second squadmate in trouble must
 *    not be hidden behind (or replace) the first.
 *  - acknowledge() tells the server, so it stops replaying that beacon to this member,
 *    then moves on to the next in the queue.
 *
 * Owns its own 'sos-received' listener and removes only that handler on cleanup —
 * never `socket.off('sos-received')` wholesale, which would tear out anyone else's.
 */
export function useIncomingSos(socket) {
  const [queue, setQueue] = useState([]);
  const queueRef = useRef(queue);
  // How many of this run of alerts have been acknowledged, for "1 of 2": counted from the
  // first alert of a run until the queue is empty again.
  const [handled, setHandled] = useState(0);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // One way in for every beacon, whether it came over the socket or from a tapped notification
  // (see useClosedAppSos): the same queue, the same de-duplication by id.
  const receive = useCallback((payload) => {
    const incoming = withId(payload);
    setQueue((current) => {
      if (current.some((sos) => sos.id === incoming.id)) return current;
      const sameSender = current.findIndex((sos) => sos.senderId === incoming.senderId);
      if (sameSender === -1) return [...current, incoming];
      const next = current.slice();
      next[sameSender] = incoming;
      return next;
    });
  }, []);

  useEffect(() => {
    socket.on('sos-received', receive);
    return () => socket.off('sos-received', receive);
  }, [socket, receive]);

  const acknowledge = useCallback(() => {
    const head = queueRef.current[0];
    if (!head) return;
    socket.emit('sos-ack', { id: head.id });
    setQueue((current) => current.filter((sos) => sos.id !== head.id));
    setHandled((n) => (queueRef.current.length > 1 ? n + 1 : 0));
  }, [socket]);

  // Ask the server to replay any beacon this member hasn't acknowledged. Call it each
  // time the client is let (back) into a squad — after a reconnect, or once approved.
  const requestSync = useCallback(() => {
    socket.emit('sos-sync');
  }, [socket]);

  // Signed out: the alerts were for the account that was signed in, and the next person to
  // pick up the phone must not find one waiting over the sign-in screen. Nothing is acknowledged:
  // the server still offers them to that account when it is back (sos-sync).
  const clear = useCallback(() => {
    setQueue([]);
    setHandled(0);
  }, []);

  return {
    current: queue[0] ?? null,
    pendingCount: Math.max(0, queue.length - 1),
    // Where this alert stands in the run: "{position} of {total}".
    position: queue.length ? handled + 1 : 0,
    total: queue.length ? handled + queue.length : 0,
    acknowledge,
    requestSync,
    receive,
    clear,
  };
}
