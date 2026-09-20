import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { LocusUpdater, isUpdaterAvailable } from '../utils/locusUpdater';
import { APK_ASSET_NAME, isUpdateAvailable, parseReleaseManifest } from '../utils/updateManifest';

// GitHub repo the updater reads releases from. Overridable at build time so a fork or a
// test repo can be pointed at without touching source.
const REPO = import.meta.env?.VITE_UPDATE_REPO || 'vithyakrish1402-web/Locus';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_TIMEOUT_MS = 15000;

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
  READY: 'ready',
  ERROR: 'error',
};

const ERROR_COPY = {
  CHECKSUM_MISMATCH:
    'INTEGRITY CHECK FAILED. The downloaded package does not match the checksum published with this release. Install blocked.',
  CHECKSUM_MISSING: 'This release was published without a checksum. Install blocked.',
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
 */
export function useAppUpdate() {
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

  const supported = isUpdaterAvailable();

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
      if (statusRef.current === UpdateStatus.CHECKING || statusRef.current === UpdateStatus.DOWNLOADING) {
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

        // AbortController rather than relying on the platform timeout: a stalled check
        // would otherwise leave the manual button spinning forever.
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

        if (response.status === 404) {
          // No release published yet - not an error state for the user.
          setStatus(manual ? UpdateStatus.UP_TO_DATE : UpdateStatus.IDLE);
          return null;
        }
        if (response.status === 403 || response.status === 429) {
          throw Object.assign(new Error(describe('RATE_LIMITED')), { code: 'RATE_LIMITED' });
        }
        if (!response.ok) {
          throw Object.assign(new Error(`GitHub returned HTTP ${response.status}`), {
            code: `HTTP_${response.status}`,
          });
        }

        const parsed = parseReleaseManifest(await response.json());
        if (!parsed.ok) {
          // A malformed release is a publishing mistake, not something the user can act
          // on - stay quiet on the automatic check, explain it on a manual one.
          if (manual) {
            setError({ code: parsed.reason, message: describe(parsed.reason) });
            setStatus(UpdateStatus.ERROR);
          } else {
            setStatus(UpdateStatus.IDLE);
          }
          return null;
        }

        if (!isUpdateAvailable(current, parsed.manifest.version)) {
          setStatus(manual ? UpdateStatus.UP_TO_DATE : UpdateStatus.IDLE);
          return null;
        }

        setManifest(parsed.manifest);
        // A mandatory release re-arms the gate even if the user dismissed an earlier one.
        if (parsed.manifest.mandatory) setDismissed(false);
        setStatus(UpdateStatus.AVAILABLE);
        return parsed.manifest;
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

  /** Download + verify + hand off to the system installer. */
  const startDownload = useCallback(async () => {
    const target = manifestRef.current;
    if (!target || !supported) return;

    setError(null);
    try {
      const permission = await LocusUpdater.getInstallPermissionStatus();
      if (!permission?.granted) {
        // One-time detour to Android's per-app consent screen. The resume listener below
        // picks the flow back up, so the user never has to tap UPDATE NOW twice.
        awaitingPermissionRef.current = true;
        setStatus(UpdateStatus.PERMISSION_REQUIRED);
        return;
      }

      setProgress({ percent: -1, loaded: 0, total: target.apkSize ?? 0 });
      setStatus(UpdateStatus.DOWNLOADING);

      const { path } = await LocusUpdater.download({
        url: target.apkUrl,
        sha256: target.sha256,
        fileName: APK_ASSET_NAME,
      });

      setStatus(UpdateStatus.READY);
      await LocusUpdater.install({ path });
      // Nothing after this: if the user confirms, Android kills and replaces the process.
    } catch (e) {
      const code = e?.code || 'IO_ERROR';
      setError({ code, message: describe(code, e?.message) });
      setStatus(UpdateStatus.ERROR);
    }
  }, [supported]);

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
  }, [supported]);

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
        startDownload();
      }
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [supported, startDownload]);

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
    openInstallSettings,
    dismiss,
    reset,
  };
}
