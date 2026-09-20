import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

/**
 * Owns the Android hardware/gesture Back button for the whole app.
 *
 * While `blocked` (an SOS is on screen) Back does nothing — ACKNOWLEDGE is the only
 * way out, and letting Back background the app would silence the klaxon.
 *
 * Otherwise it does what Android does by default: step back through WebView history if
 * there is any, else send the app to the background (the same as the system's own
 * root-activity behaviour on Android 12+; the app stays alive, it doesn't quit).
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

    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (blockedRef.current) return;
      if (canGoBack) window.history.back();
      else CapacitorApp.minimizeApp();
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
