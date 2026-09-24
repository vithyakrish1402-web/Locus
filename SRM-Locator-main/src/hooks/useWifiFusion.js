import { useCallback, useEffect, useRef } from 'react';
import { WIFI_POSITIONING_ENABLED, resolvePosition } from '../utils/positionSource.js';

/**
 * WiFi Arc Stage 6. Returns positionFor(gps) -> { lat, lng, positionSource } for the
 * `update-location` emits in App.jsx.
 *
 * With WIFI_POSITIONING_ENABLED false (the default) this is the whole story: the effect
 * returns before doing anything, wifiFusion.js is never imported (and, the flag being a
 * constant, is left out of the build), and positionFor always answers with GPS.
 *
 * With it on, scanning runs only while `active` - i.e. while this phone is actually
 * sending telemetry to a squad - and stops the moment it isn't.
 *
 * @param {boolean} active
 */
export function useWifiFusion(active) {
  const fusionRef = useRef(null);

  useEffect(() => {
    if (WIFI_POSITIONING_ENABLED && active) {
      let cancelled = false;
      let fusion = null;
      import('../utils/wifiFusion.js')
        .then(({ startWifiFusion }) => {
          if (cancelled) return;
          fusion = startWifiFusion();
          fusionRef.current = fusion;
        })
        .catch((err) => {
          // A failed chunk load leaves positionFor on GPS, which is today's behaviour.
          console.warn('[WIFI] Fusion unavailable, staying on GPS:', err?.message);
        });
      return () => {
        cancelled = true;
        fusion?.stop();
        fusionRef.current = null;
      };
    }
  }, [active]);

  return useCallback((gps) => resolvePosition(gps, fusionRef.current), []);
}
