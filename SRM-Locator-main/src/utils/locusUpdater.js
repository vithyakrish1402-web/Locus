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
    cancelDownload: () => Promise.resolve(),
    clearCache: () => Promise.resolve(),
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
});

/** True only inside the native Android shell, where self-updating is possible at all. */
export function isUpdaterAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
