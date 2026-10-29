// Thin JS bridge to the locally-defined LocusUpdater native plugin
// (android/app/src/main/java/com/locus/app/LocusUpdaterPlugin.java).
//
// registerPlugin() resolves to the native implementation inside the Capacitor WebView
// and to the `web` stub below in a browser (npm run dev, Vitest, jsdom), so importing
// this module is always safe - the caller just has to respect isUpdaterAvailable().

import { registerPlugin, Capacitor } from '@capacitor/core';

const unavailable = () =>
  Promise.reject(
    Object.assign(new Error('The LOCUS updater is only available in the Android app'), {
      code: 'UNAVAILABLE',
    })
  );

export const LocusUpdater = registerPlugin('LocusUpdater', {
  // Browser fallback. Deliberately rejecting rather than no-op resolving: a silent
  // success here would make the dev-server UI claim an update installed when nothing did.
  web: {
    getInstallPermissionStatus: () => Promise.resolve({ granted: false }),
    openInstallSettings: unavailable,
    download: unavailable,
    install: unavailable,
    shareFile: unavailable,
    shareTextFile: unavailable,
    cancelDownload: () => Promise.resolve(),
    clearCache: () => Promise.resolve(),
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
});

// One download at a time. The native downloader keeps a single download: starting one cancels
// the one running, and a cancel stops whichever is running. So the app update and Send LOCUS
// used to cancel each other. Each now waits here for the other to finish.
let downloadQueue = Promise.resolve();

/**
 * Run `task` (which starts a LocusUpdater.download) once every download queued before it has
 * settled. @returns the task's own promise
 */
export function queueDownload(task) {
  const turn = downloadQueue.then(task, task);
  downloadQueue = turn.catch(() => {});
  return turn;
}

/** True only inside the native Android shell, where self-updating is possible at all. */
export function isUpdaterAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * True when this app's native plugin has shareFile(), which came after v1.1.0. A JS bundle
 * also runs on older shells, so ask the plugin's native method list rather than assume:
 * calling a missing method would only fail after the whole download.
 */
export function canShareInstaller() {
  if (!isUpdaterAvailable()) return false;
  const header = Capacitor.PluginHeaders?.find((h) => h.name === 'LocusUpdater');
  return Boolean(header?.methods?.some((m) => m.name === 'shareFile'));
}
