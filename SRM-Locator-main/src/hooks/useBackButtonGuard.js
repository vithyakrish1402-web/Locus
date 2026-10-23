import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { runBackHandler } from '../utils/backHandlers';
import { notify } from '../utils/notify';
import { NOTICES } from '../copy/notices';

// On the home screen, a second Back within this long of the first leaves the app; the first
// only says so. Anywhere else Back steps back (the handlers in utils/backHandlers.js).
export const BACK_EXIT_WINDOW_MS = 2000;

/**
 * Owns the Android hardware/gesture Back button for the whole app.
 *
 * While `blocked` (an SOS is on screen) Back does nothing — ACKNOWLEDGE is the only
 * way out, and letting Back background the app would silence the klaxon.
 *
 * Otherwise the newest surface that wants Back gets it (utils/backHandlers.js: App registers
 * one ladder that closes the top-most overlay, then goes back one level, then to the map).
 * With nothing left to close, it steps back through WebView history if there is any; on the
 * home screen with none, the first press says "Press back again to exit" and a second within
 * BACK_EXIT_WINDOW_MS leaves the app. It used to send the app to the background on the first
 * press from anywhere, because only AR Scan registered a handler, so Back from a panel, a
 * sheet or Settings looked like the app closing.
 *
 * Why one always-on listener rather than adding/removing one around the overlay: with
 * @capacitor/app installed the plugin's back callback is always active, and with no
 * JS listener and no history it silently swallows Back entirely — the app could never
 * be left. Registering once, for the lifetime of the app, and branching inside, also
 * leaves no gap between two queued SOS overlays where Back would slip through.
 *
 * No-op on the web, where there is no hardware Back button to guard.
 */
export function useBackButtonGuard(blocked) {
  const blockedRef = useRef(blocked);

  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let cancelled = false;
    let handle = null;
    let firstPressAt = -Infinity; // the home-screen press that said "again to exit"

    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (blockedRef.current) return;
      if (runBackHandler()) { firstPressAt = -Infinity; return; }
      if (canGoBack) { window.history.back(); return; }
      const now = Date.now();
      if (now - firstPressAt < BACK_EXIT_WINDOW_MS) {
        CapacitorApp.exitApp();
        return;
      }
      firstPressAt = now;
      notify.info(NOTICES.backToExit, { duration: BACK_EXIT_WINDOW_MS, haptic: false });
    }).then((registered) => {
      // Unmounted before the plugin finished registering: remove it straight away.
      if (cancelled) registered.remove();
      else handle = registered;
    });

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, []);
}
