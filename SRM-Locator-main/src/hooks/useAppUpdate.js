import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { LocusUpdater, isUpdaterAvailable } from '../utils/locusUpdater';
import { APK_ASSET_NAME, isUpdateAvailable, selectLatestApkRelease } from '../utils/updateManifest';
import { UPDATES_OFF } from '../utils/buildMode';
import { getReleases } from '../utils/releasesLookup';

// The releases list comes from utils/releasesLookup.js, shared with the live-update check
// and Send LOCUS (the repo is overridable there with VITE_UPDATE_REPO). It is the listing
// rather than /releases/latest: "latest" is whichever release is newest overall, and the v*
// and js-* series share a repo — so a JS bundle release would hand this check a tag it
// cannot parse and hide every APK update behind it. selectLatestApkRelease filters to v*
// and drops drafts/prereleases, which /releases/latest used to exclude server-side.

// Assumed values for the APK download (owner's brief, 2026-10-10):
// - APK_DOWNLOAD_STALL_TIMEOUT_MS: no progress for this long counts as stuck. The download
//   is cancelled (the native side deletes the partial file) and the screen offers Try again.
// - APK_DOWNLOAD_MAX_RETRIES_AUTO: silent retries after a stall or a broken download before
//   the failure is shown. 0: the user taps to retry.
export const APK_DOWNLOAD_STALL_TIMEOUT_MS = 30000;
export const APK_DOWNLOAD_MAX_RETRIES_AUTO = 0;

/**
 * Cold-start throttle. Module scope on purpose: it survives React remounts (StrictMode
 * double-mount, auth state flipping the tree) but dies with the JS context, which is
 * exactly "once per cold start". No periodic background polling - see UPDATER.md.
 */
let coldStartCheckDone = false;

/** Exported for tests, which need each case to start from a clean slate. */
export function __resetColdStartThrottle() {
  coldStartCheckDone = false;
}

export const UpdateStatus = {
  IDLE: 'idle',
  CHECKING: 'checking',
  UP_TO_DATE: 'up-to-date',
  AVAILABLE: 'available',
  PERMISSION_REQUIRED: 'permission-required',
  DOWNLOADING: 'downloading',
  // Every byte is saved; the size and checksum are being checked.
  VERIFYING: 'verifying',
  // Saved and checked; waiting for the tap that opens Android's installer.
  READY: 'ready',
  ERROR: 'error',
};

/**
 * The percent the progress bar may show: 100 only once the file is saved and checked
 * (READY), at most 99 before that, and -1 (no number) when the size is unknown.
 */
export function displayPercent(status, percent) {
  if (status === UpdateStatus.READY) return 100;
  if (typeof percent !== 'number' || percent < 0) return -1;
  return Math.min(99, percent);
}

// Failures it is worth silently trying again (see APK_DOWNLOAD_MAX_RETRIES_AUTO). Never a
// checksum or size mismatch: those fail closed and are shown.
const AUTO_RETRYABLE = new Set(['STALLED', 'IO_ERROR']);

const ERROR_COPY = {
  CHECKSUM_MISMATCH:
    'INTEGRITY CHECK FAILED. The downloaded package does not match the checksum published with this release. Install blocked.',
  CHECKSUM_MISSING: 'This release was published without a checksum. Install blocked.',
  SIZE_MISMATCH: 'The downloaded package is not the size published with this release. Install blocked.',
  STALLED: 'The download stopped making progress.',
  PERMISSION_DENIED: 'Android blocked the install. Grant "install unknown apps" for LOCUS and retry.',
  CANCELLED: 'Download cancelled.',
  UNAVAILABLE: 'Self-update is only available in the LOCUS Android app.',
  RATE_LIMITED: 'GitHub rate limit reached. Try again in a few minutes.',
  NO_RELEASES: 'No release has been published yet.',
  MISSING_APK_ASSET: `This release has no ${APK_ASSET_NAME} attached.`,
  MISSING_CHECKSUM: 'This release was published without a checksum. Install blocked.',
  UNPARSEABLE_TAG: 'This release is tagged with an unrecognisable version.',
  DRAFT_RELEASE: 'No release has been published yet.',
  MALFORMED_RELEASE: 'GitHub returned an unexpected response.',
  NETWORK: 'Could not reach the update server. Check your connection.',
};

const describe = (code, fallback) => ERROR_COPY[code] || fallback || 'Update failed.';

/**
 * Drives the full-APK self-update flow: check -> download -> verify -> install.
 *
 * The hook owns all policy; the native plugin only moves bytes and fires intents. The
 * returned `mandatory` flag is what the UI gates the whole app behind - see UpdateModal.
 *
 * Every download ends on a screen with a button: READY (install), ERROR (try again) or
 * PERMISSION_REQUIRED (open the setting). The stall timer is what guarantees it when the
 * native side goes quiet.
 *
 * @param {{stallTimeoutMs?: number, maxAutoRetries?: number}} options for tests; the app
 *   uses the APK_DOWNLOAD_* defaults above.
 */
export function useAppUpdate({
  stallTimeoutMs = APK_DOWNLOAD_STALL_TIMEOUT_MS,
  maxAutoRetries = APK_DOWNLOAD_MAX_RETRIES_AUTO,
} = {}) {
  const [status, setStatus] = useState(UpdateStatus.IDLE);
  const [manifest, setManifest] = useState(null);
  const [installedVersion, setInstalledVersion] = useState(null);
  const [progress, setProgress] = useState({ percent: -1, loaded: 0, total: 0 });
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // Kept in refs so the resume listener and the progress listener can read current
  // values without being torn down and re-registered on every state change.
  const statusRef = useRef(status);
  const manifestRef = useRef(manifest);
  const awaitingPermissionRef = useRef(false);
  statusRef.current = status;
  manifestRef.current = manifest;
  // One number per download. An answer or progress event for an older number (a download
  // given up on after a stall) is ignored, so it can never move the screen.
  const attemptRef = useRef(0);
  const downloadingRef = useRef(false);
  const stallTimerRef = useRef(null);
  // The checked APK on disk, so installing again (after a cancelled installer or the
  // permission detour) never downloads again.
  const verifiedPathRef = useRef(null);
  const installingRef = useRef(false);
  const autoRetriesRef = useRef(0);
  const startDownloadRef = useRef(null);
  const optionsRef = useRef({ stallTimeoutMs, maxAutoRetries });
  optionsRef.current = { stallTimeoutMs, maxAutoRetries };

  // Never in the side-by-side test build (utils/buildMode.js): it would offer the release APK.
  const supported = !UPDATES_OFF && isUpdaterAvailable();

  /**
   * @param {{manual?: boolean}} options manual checks report "you are up to date" and
   *   surface errors; the automatic cold-start check stays silent unless there is news.
   */
  const check = useCallback(
    async ({ manual = false } = {}) => {
      if (!supported) {
        if (manual) {
          setError({ code: 'UNAVAILABLE', message: describe('UNAVAILABLE') });
          setStatus(UpdateStatus.ERROR);
        }
        return null;
      }
      if (
        statusRef.current === UpdateStatus.CHECKING ||
        statusRef.current === UpdateStatus.DOWNLOADING ||
        statusRef.current === UpdateStatus.VERIFYING
      ) {
        return null;
      }

      setError(null);
      setStatus(UpdateStatus.CHECKING);

      let current = installedVersion;
      try {
        if (!current) {
          const info = await CapacitorApp.getInfo();
          current = info?.version ?? null;
          setInstalledVersion(current);
        }

        // This launch's shared answer, or a fresh one when the person asked
        // (utils/releasesLookup.js). Its errors carry a code: RATE_LIMITED, HTTP_<status>.
        let releases;
        try {
          releases = await getReleases({ fresh: manual });
        } catch (e) {
          if (e?.status === 404) {
            // No repo/releases visible - not an error state for the user. The listing
            // endpoint answers 200 with [] rather than 404 for a repo with no releases,
            // which the empty-manifest branch below handles.
            setStatus(manual ? UpdateStatus.UP_TO_DATE : UpdateStatus.IDLE);
            return null;
          }
          throw e;
        }

        const manifest = selectLatestApkRelease(releases);
        if (!manifest) {
          // No usable v* release in the listing: none published yet, or every candidate
          // was a draft, a prerelease, or malformed. Fail closed — offer nothing — the
          // same as an unparseable release did before. A publishing mistake is not
          // something the user can act on, so stay quiet on the automatic check and
          // explain it only when they asked.
          if (manual) {
            setError({ code: 'NO_RELEASES', message: describe('NO_RELEASES') });
            setStatus(UpdateStatus.ERROR);
          } else {
            setStatus(UpdateStatus.IDLE);
          }
          return null;
        }

        if (!isUpdateAvailable(current, manifest.version)) {
          setStatus(manual ? UpdateStatus.UP_TO_DATE : UpdateStatus.IDLE);
          return null;
        }

        setManifest(manifest);
        // A mandatory release re-arms the gate even if the user dismissed an earlier one.
        if (manifest.mandatory) setDismissed(false);
        setStatus(UpdateStatus.AVAILABLE);
        return manifest;
      } catch (e) {
        const code = e?.code || (e?.name === 'AbortError' ? 'NETWORK' : 'NETWORK');
        if (manual) {
          setError({ code, message: describe(code, e?.message) });
          setStatus(UpdateStatus.ERROR);
        } else {
          setStatus(UpdateStatus.IDLE);
        }
        return null;
      }
    },
    [supported, installedVersion]
  );

  const clearStallTimer = useCallback(() => {
    clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  }, []);

  /** A download failed: retry silently if allowed, otherwise show it. */
  const downloadFailed = useCallback((code, message) => {
    if (AUTO_RETRYABLE.has(code) && autoRetriesRef.current < optionsRef.current.maxAutoRetries) {
      autoRetriesRef.current += 1;
      startDownloadRef.current?.({ autoRetry: true });
      return;
    }
    // `during` marks it as a download failure, whatever its code, for the title and wording.
    setError({ code, message: describe(code, message), during: 'download' });
    setStatus(UpdateStatus.ERROR);
  }, []);

  /** (Re)start the stall countdown for this attempt; called on every progress event. */
  const armStallTimer = useCallback(
    (attempt) => {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = setTimeout(() => {
        if (attempt !== attemptRef.current) return;
        // Give up on this attempt: anything it still answers is ignored from here on.
        attemptRef.current += 1;
        downloadingRef.current = false;
        stallTimerRef.current = null;
        LocusUpdater.cancelDownload().catch(() => {});
        downloadFailed('STALLED');
      }, optionsRef.current.stallTimeoutMs);
    },
    [downloadFailed]
  );

  /** Download + verify. Stops at READY; installUpdate() hands it to Android. */
  const startDownload = useCallback(
    async ({ autoRetry = false } = {}) => {
      const target = manifestRef.current;
      if (!target || !supported || downloadingRef.current) return;

      if (!autoRetry) autoRetriesRef.current = 0;
      setError(null);
      verifiedPathRef.current = null;
      const attempt = ++attemptRef.current;
      try {
        const permission = await LocusUpdater.getInstallPermissionStatus();
        if (attempt !== attemptRef.current) return;
        if (!permission?.granted) {
          // One-time detour to Android's per-app consent screen. The resume listener below
          // picks the flow back up, so the user never has to tap UPDATE NOW twice.
          awaitingPermissionRef.current = true;
          setStatus(UpdateStatus.PERMISSION_REQUIRED);
          return;
        }

        setProgress({ percent: -1, loaded: 0, total: target.apkSize ?? 0 });
        setStatus(UpdateStatus.DOWNLOADING);
        downloadingRef.current = true;
        armStallTimer(attempt);

        const { path } = await LocusUpdater.download({
          url: target.apkUrl,
          sha256: target.sha256,
          fileName: APK_ASSET_NAME,
          // Fail closed on size too (native refuses a different byte count).
          ...(typeof target.apkSize === 'number' && target.apkSize > 0 ? { size: target.apkSize } : {}),
        });
        if (attempt !== attemptRef.current) return;

        verifiedPathRef.current = path;
        setStatus(UpdateStatus.READY);
      } catch (e) {
        if (attempt !== attemptRef.current) return;
        downloadingRef.current = false;
        clearStallTimer();
        downloadFailed(e?.code || 'IO_ERROR', e?.message);
      } finally {
        if (attempt === attemptRef.current) {
          downloadingRef.current = false;
          clearStallTimer();
        }
      }
    },
    [supported, armStallTimer, clearStallTimer, downloadFailed]
  );
  startDownloadRef.current = startDownload;

  /** Hand the checked APK to Android's installer. Downloads first if there is none. */
  const installUpdate = useCallback(async () => {
    const path = verifiedPathRef.current;
    if (!path) {
      startDownload();
      return;
    }
    if (installingRef.current) return;
    installingRef.current = true;
    setError(null);
    try {
      const permission = await LocusUpdater.getInstallPermissionStatus();
      if (!permission?.granted) {
        awaitingPermissionRef.current = true;
        setStatus(UpdateStatus.PERMISSION_REQUIRED);
        return;
      }
      await LocusUpdater.install({ path });
      // Resolving only means Android's installer was opened. Stay on READY with its button
      // live: if the install is confirmed Android replaces this process; if it is cancelled
      // or refused, the user lands back here and can tap Install again.
      setStatus(UpdateStatus.READY);
    } catch (e) {
      const code = e?.code || 'INSTALL_FAILED';
      if (code === 'PERMISSION_DENIED') {
        awaitingPermissionRef.current = true;
        setStatus(UpdateStatus.PERMISSION_REQUIRED);
        return;
      }
      // The file is gone (cache cleared): Try again downloads it afresh.
      if (code === 'NOT_FOUND') verifiedPathRef.current = null;
      setError({ code, message: describe(code, e?.message), during: 'download' });
      setStatus(UpdateStatus.ERROR);
    } finally {
      installingRef.current = false;
    }
  }, [startDownload]);

  const openInstallSettings = useCallback(async () => {
    try {
      await LocusUpdater.openInstallSettings();
    } catch (e) {
      setError({ code: e?.code || 'IO_ERROR', message: describe(e?.code, e?.message) });
      setStatus(UpdateStatus.ERROR);
    }
  }, []);

  /** Hide a non-mandatory update for the rest of this session. */
  const dismiss = useCallback(() => setDismissed(true), []);

  /** Back out of an error/permission state without leaving the modal stuck. */
  const reset = useCallback(() => {
    setError(null);
    setStatus(manifestRef.current ? UpdateStatus.AVAILABLE : UpdateStatus.IDLE);
  }, []);

  // --- native download progress ---
  useEffect(() => {
    if (!supported) return undefined;
    let handle;
    let cancelled = false;
    LocusUpdater.addListener('downloadProgress', (event) => {
      // Only the live attempt moves the screen; each event proves it is not stuck.
      if (!downloadingRef.current) return;
      armStallTimer(attemptRef.current);
      if (event?.stage === 'verifying') setStatus(UpdateStatus.VERIFYING);
      setProgress({
        percent: typeof event?.percent === 'number' ? event.percent : -1,
        loaded: event?.loaded ?? 0,
        total: event?.total ?? 0,
      });
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [supported, armStallTimer]);

  useEffect(() => clearStallTimer, [clearStallTimer]);

  // --- resume after the "install unknown apps" detour ---
  useEffect(() => {
    if (!supported) return undefined;
    let handle;
    let cancelled = false;
    CapacitorApp.addListener('resume', async () => {
      if (!awaitingPermissionRef.current) return;
      const permission = await LocusUpdater.getInstallPermissionStatus().catch(() => null);
      if (permission?.granted) {
        awaitingPermissionRef.current = false;
        // Already downloaded and checked: go straight to the installer.
        if (verifiedPathRef.current) installUpdate();
        else startDownload();
      }
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [supported, startDownload, installUpdate]);

  // --- automatic check, once per cold start ---
  useEffect(() => {
    if (!supported || coldStartCheckDone) return;
    coldStartCheckDone = true;
    check({ manual: false });
  }, [supported, check]);

  const mandatory = Boolean(manifest?.mandatory);

  return {
    supported,
    status,
    manifest,
    installedVersion,
    progress,
    error,
    mandatory,
    // A mandatory update can never be dismissed, whatever the user tapped before.
    dismissed: mandatory ? false : dismissed,
    check,
    startDownload,
    installUpdate,
    openInstallSettings,
    dismiss,
    reset,
  };
}
