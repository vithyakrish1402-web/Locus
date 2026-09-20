import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { CapacitorUpdater, isLiveUpdaterAvailable, notifyAppReady } from '../utils/liveUpdater';
import { BUNDLE_TAG_PREFIX, selectLatestBundleRelease, shouldApplyBundle } from '../utils/liveUpdateManifest';

// Phase 2: JS-only live updates. Sits on top of Phase 1 and is deliberately separable —
// delete this hook, LiveUpdateToast, liveUpdater.js, liveUpdateManifest.js,
// scripts/release-bundle.mjs and the @capgo dependency and Phase 1 still works untouched.

const REPO = import.meta.env?.VITE_UPDATE_REPO || 'vithyakrish1402-web/Locus';
// Listing rather than /releases/latest: "latest" is whichever release is newest overall,
// which will usually be a native v* one. We need the newest js-* specifically.
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const CHECK_TIMEOUT_MS = 15000;

/** Once per cold start, same rationale as the Phase 1 throttle. */
let coldStartCheckDone = false;

/** Exported for tests. */
export function __resetLiveColdStartThrottle() {
  coldStartCheckDone = false;
}

export const LiveUpdateStatus = {
  IDLE: 'idle',
  CHECKING: 'checking',
  DOWNLOADING: 'downloading',
  READY: 'ready',
  BLOCKED: 'blocked',
  ERROR: 'error',
};

/**
 * Checks for a newer JS bundle, gates it against the installed native shell, downloads
 * and stages it — then stops. Applying it is the user's call (a tap on the toast),
 * because CapacitorUpdater.set() reloads the WebView immediately and yanking the map out
 * from under someone mid-navigation is exactly the wrong moment.
 */
export function useLiveUpdate() {
  const [status, setStatus] = useState(LiveUpdateStatus.IDLE);
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // The staged bundle handle from download(); set() needs the object, not the version.
  const stagedRef = useRef(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const supported = isLiveUpdaterAvailable();

  // Disarm the rollback timer as early as possible. If this bundle is a downloaded one
  // and this never runs, the plugin reverts to the previous bundle on next launch.
  useEffect(() => {
    notifyAppReady();
  }, []);

  const check = useCallback(async () => {
    if (!supported) return null;
    if (statusRef.current === LiveUpdateStatus.CHECKING || statusRef.current === LiveUpdateStatus.DOWNLOADING) {
      return null;
    }

    setError(null);
    setStatus(LiveUpdateStatus.CHECKING);

    try {
      const [info, current] = await Promise.all([
        CapacitorApp.getInfo(),
        CapacitorUpdater.current().catch(() => null),
      ]);
      const nativeVersion = info?.version ?? null;
      const currentBundleVersion = current?.bundle?.version ?? null;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);

      const latest = selectLatestBundleRelease(await response.json());
      const decision = shouldApplyBundle({ nativeVersion, currentBundleVersion, manifest: latest });

      if (!decision.apply) {
        // NATIVE_TOO_OLD is surfaced (it means "go install the APK update"); everything
        // else is just "nothing to do" and stays silent.
        if (decision.reason === 'NATIVE_TOO_OLD') {
          setManifest(latest);
          setStatus(LiveUpdateStatus.BLOCKED);
        } else {
          setStatus(LiveUpdateStatus.IDLE);
        }
        return null;
      }

      setManifest(latest);
      setStatus(LiveUpdateStatus.DOWNLOADING);

      // checksum is verified natively by the plugin; a mismatch rejects the bundle.
      stagedRef.current = await CapacitorUpdater.download({
        url: latest.zipUrl,
        version: latest.version,
        checksum: latest.sha256,
      });

      setStatus(LiveUpdateStatus.READY);
      return latest;
    } catch (e) {
      // A failed live-update check is never worth interrupting anyone over — the app
      // they already have keeps working, and Phase 1 remains the backstop.
      setError({ message: e?.message || 'Live update check failed' });
      setStatus(LiveUpdateStatus.ERROR);
      return null;
    }
  }, [supported]);

  /** Activate the staged bundle. This reloads the WebView. */
  const applyNow = useCallback(async () => {
    const staged = stagedRef.current;
    if (!staged) return;
    try {
      await CapacitorUpdater.set(staged);
      // Not reached in practice: set() reloads into the new bundle from here.
    } catch (e) {
      setError({ message: e?.message || 'Could not apply the update' });
      setStatus(LiveUpdateStatus.ERROR);
    }
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  useEffect(() => {
    if (!supported || coldStartCheckDone) return;
    coldStartCheckDone = true;
    check();
  }, [supported, check]);

  return {
    supported,
    status,
    manifest,
    error,
    dismissed,
    // Only the two states the user can act on ever reach the UI.
    visible: !dismissed && (status === LiveUpdateStatus.READY || status === LiveUpdateStatus.BLOCKED),
    tagPrefix: BUNDLE_TAG_PREFIX,
    check,
    applyNow,
    dismiss,
  };
}
