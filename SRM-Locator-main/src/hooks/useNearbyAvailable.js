// Whether the server has Nearby Join on (Stage 7). Until it says so, no Nearby screen shows, so the
// app is exactly as in js-1.1.87 (with Stages 4 and 5) on a server with it off, or one too old to
// know it.
//
// Asked with a scan from no group, which the server answers without counting it as a scan:
// 'not-in-squad' means Nearby is on, 'disabled' that it is off. No answer (an older server) is off.
// Asked again on every reconnect, since a restarted server may have changed its mind.
import { useEffect, useState } from 'react';
import { NEARBY_REQUEST_TIMEOUT_MS } from '../utils/nearby';

export function useNearbyAvailable({ socket, enabled }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!enabled || !socket) return undefined;
    let live = true;
    const timers = new Set();
    const probe = () => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (live) setAvailable(false);
      }, NEARBY_REQUEST_TIMEOUT_MS);
      timers.add(timer);
      socket.emit('nearby-scan', { roomCode: null }, (reply) => {
        clearTimeout(timer);
        timers.delete(timer);
        if (live) setAvailable(reply?.reason === 'not-in-squad');
      });
    };
    probe();
    socket.on('connect', probe);
    return () => {
      live = false;
      timers.forEach(clearTimeout);
      socket.off('connect', probe);
    };
  }, [enabled, socket]);
  return Boolean(enabled) && available;
}
