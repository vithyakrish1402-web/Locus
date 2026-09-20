import { useCallback, useEffect, useRef, useState } from 'react';

// An older server doesn't send an id; fall back to something stable enough to dedupe.
const withId = (sos) => ({ ...sos, id: sos.id ?? `${sos.senderId}:${sos.timestamp}` });

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

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    const onSosReceived = (payload) => {
      const incoming = withId(payload);
      setQueue((current) => {
        if (current.some((sos) => sos.id === incoming.id)) return current;
        const sameSender = current.findIndex((sos) => sos.senderId === incoming.senderId);
        if (sameSender === -1) return [...current, incoming];
        const next = current.slice();
        next[sameSender] = incoming;
        return next;
      });
    };
    socket.on('sos-received', onSosReceived);
    return () => socket.off('sos-received', onSosReceived);
  }, [socket]);

  const acknowledge = useCallback(() => {
    const head = queueRef.current[0];
    if (!head) return;
    socket.emit('sos-ack', { id: head.id });
    setQueue((current) => current.filter((sos) => sos.id !== head.id));
  }, [socket]);

  // Ask the server to replay any beacon this member hasn't acknowledged. Call it each
  // time the client is let (back) into a squad — after a reconnect, or once approved.
  const requestSync = useCallback(() => {
    socket.emit('sos-sync');
  }, [socket]);

  return {
    current: queue[0] ?? null,
    pendingCount: Math.max(0, queue.length - 1),
    acknowledge,
    requestSync,
  };
}
