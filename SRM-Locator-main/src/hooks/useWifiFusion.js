import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SHOW_INDOOR_POSITION_TO_SQUAD,
  WIFI_POSITIONING_ENABLED,
  resolvePosition,
  withIndoorFields,
} from '../utils/positionSource.js';

/**
 * WiFi Arc Stages 6 and 7. Returns:
 * - positionFor(gps) -> { lat, lng, positionSource, building?, floor? } for the
 *   `update-location` emits in App.jsx (building/floor only with
 *   SHOW_INDOOR_POSITION_TO_SQUAD on - see withIndoorFields);
 * - indoor: the fusion controller's current indoor reading ({ lat, lng, building, floor,
 *   confidence, floors, expiresAt }) for the map UI, or null;
 * - lastCycle: what the last scan cycle did (see wifiFusion's lastCycle), for the owner's
 *   field-test readout, or null.
 *
 * With WIFI_POSITIONING_ENABLED false (the default) this is the whole story: the effects
 * return before doing anything, wifiFusion.js is never imported (and, the flag being a
 * constant, is left out of the build), positionFor always answers with GPS, and indoor is
 * always null.
 *
 * With it on, scanning runs only while `active` - i.e. while this phone is actually
 * sending telemetry to a squad - and stops the moment it isn't.
 *
 * @param {boolean} active
 */
export function useWifiFusion(active) {
  const fusionRef = useRef(null);
  const [indoor, setIndoor] = useState(null);
  const [lastCycle, setLastCycle] = useState(null);

  useEffect(() => {
    if (WIFI_POSITIONING_ENABLED && active) {
      let cancelled = false;
      let fusion = null;
      let unsubscribe = null;
      import('../utils/wifiFusion.js')
        .then(({ startWifiFusion }) => {
          if (cancelled) return;
          fusion = startWifiFusion();
          fusionRef.current = fusion;
          const sync = () => {
            setIndoor(fusion.indoor());
            setLastCycle(fusion.lastCycle?.() ?? null);
          };
          unsubscribe = fusion.subscribe(sync);
          sync(); // 'unavailable' is known before any cycle runs
        })
        .catch((err) => {
          // A failed chunk load leaves positionFor on GPS, which is today's behaviour.
          console.warn('[WIFI] Fusion unavailable, staying on GPS:', err?.message);
        });
      return () => {
        cancelled = true;
        unsubscribe?.();
        fusion?.stop();
        fusionRef.current = null;
        setIndoor(null);
        setLastCycle(null);
      };
    }
  }, [active]);

  // Cycles replace the reading every scan interval, but they stop while timers are paused
  // (app in the background). This drops a reading the moment it goes stale, so the map
  // never shows an indoor position that positionFor has already stopped broadcasting.
  useEffect(() => {
    if (!WIFI_POSITIONING_ENABLED || !indoor) return;
    const timer = setTimeout(
      () => setIndoor(fusionRef.current?.indoor() ?? null),
      Math.max(0, indoor.expiresAt - Date.now()) + 1
    );
    return () => clearTimeout(timer);
  }, [indoor]);

  const positionFor = useCallback((gps) => {
    const position = resolvePosition(gps, fusionRef.current);
    // A constant, so a squad-flag-off build keeps only the plain position.
    return SHOW_INDOOR_POSITION_TO_SQUAD ? withIndoorFields(position, fusionRef.current) : position;
  }, []);
  return { positionFor, indoor, lastCycle };
}
