// Bridge to @capgo/capacitor-updater — the one new dependency Phase 2 adds.
//
// Running in MANUAL mode (capacitor.config.json -> plugins.CapacitorUpdater.autoUpdate:
// "off"): the plugin does not talk to any server of its own. LOCUS fetches its own
// manifest from GitHub Releases, applies the MIN_NATIVE compatibility gate itself, and
// only then hands the plugin a URL. The plugin's job is the part that genuinely needs
// native code: unzipping a bundle into the WebView's asset path and swapping to it.

import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

export { CapacitorUpdater };

/**
 * Live updates are Android-only here, and meaningless on the web where the "bundle" is
 * whatever the dev server or host is already serving.
 */
export function isLiveUpdaterAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * Tell the native layer the JS booted successfully.
 *
 * Non-negotiable and must run early: the plugin arms a rollback timer
 * (appReadyTimeout, 15s in our config) on every bundle it activates, and a bundle that
 * never calls this is reverted to the previous one on the next launch. That is the
 * safety net that stops a broken JS release from being unrecoverable — but it also
 * means forgetting this call makes every good update silently roll back too.
 */
export async function notifyAppReady() {
  if (!isLiveUpdaterAvailable()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // Nothing useful to do: on a builtin bundle there is nothing to roll back to, and
    // throwing here would take down app start over a non-essential call.
  }
}
