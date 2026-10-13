import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { CapacitorUpdater, isLiveUpdaterAvailable, notifyAppReady } from '../utils/liveUpdater';
import { BUNDLE_TAG_PREFIX, selectLatestBundleRelease, shouldApplyBundle } from '../utils/liveUpdateManifest';
import { UPDATES_OFF } from '../utils/buildMode';
import { getReleases } from '../utils/releasesLookup';

// Phase 2: JS-only live updates. Sits on top of Phase 1 and is deliberately separable —
// delete this hook, LiveUpdateToast, liveUpdater.js, liveUpdateManifest.js,
// scripts/release-bundle.mjs and the @capgo dependency and Phase 1 still works untouched.

// The releases list comes from utils/releasesLookup.js, shared with the APK update check and
// Send LOCUS. It is the listing rather than /releases/latest: "latest" is whichever release
// is newest overall, which will usually be a native v* one. We need the newest js-* specifically.

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
  // Which state the strip was dismissed in: dismissing the DOWNLOADING notice must not also
  // swallow the RESTART that follows it.
  const [dismissedIn, setDismissedIn] = useState(null);
  // Download progress: when it started (for the elapsed-seconds readout) and the plugin's
  // last reported percent, or null before the first report. On the phone the plugin can
  // sit a minute before its first byte (a stalled connection, then a quick retry), so
  // "started, no percent yet" is a state of its own and the strip says it is still working.
  const [download, setDownload] = useState(null);

  // The staged bundle handle from download(); set() needs the object, not the version.
  const stagedRef = useRef(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  // Never in the side-by-side test build (utils/buildMode.js): it would swap its JavaScript.
  const supported = !UPDATES_OFF && isLiveUpdaterAvailable();

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

      // This launch's shared answer (utils/releasesLookup.js); the APK check usually asked first.
      const latest = selectLatestBundleRelease(await getReleases());
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
      setDownload({ startedAt: Date.now(), percent: null });
      setStatus(LiveUpdateStatus.DOWNLOADING);

      // Progress, when the plugin reports it. A listener that fails to register costs the
      // percentage only: the strip still shows the download is running.
      let progressHandle = null;
      try {
        progressHandle = await CapacitorUpdater.addListener('download', (event) => {
          const percent = Number(event?.percent);
          if (!Number.isFinite(percent)) return;
          setDownload((d) => (d ? { ...d, percent: Math.max(0, Math.min(100, Math.round(percent))) } : d));
        });
      } catch {
        progressHandle = null;
      }

      try {
        // checksum is verified natively by the plugin; a mismatch rejects the bundle.
        stagedRef.current = await CapacitorUpdater.download({
          url: latest.zipUrl,
          version: latest.version,
          checksum: latest.sha256,
        });
      } finally {
        progressHandle?.remove?.();
      }

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

  const dismiss = useCallback(() => setDismissedIn(statusRef.current), []);
  const dismissed = dismissedIn !== null && dismissedIn === status;

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
    download,
    // What reaches the UI: the two states the user can act on, a download in progress (so
    // nobody closes the app wondering whether anything is happening - closing it kills the
    // download), and a failure after a download began. A check that fails before finding
    // anything stays silent: the app they have keeps working.
    visible:
      !dismissed &&
      (status === LiveUpdateStatus.READY ||
        status === LiveUpdateStatus.BLOCKED ||
        status === LiveUpdateStatus.DOWNLOADING ||
        (status === LiveUpdateStatus.ERROR && manifest !== null)),
    tagPrefix: BUNDLE_TAG_PREFIX,
    check,
    applyNow,
    dismiss,
  };
}
