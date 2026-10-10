import { useCallback, useEffect, useRef, useState } from 'react';
import { LocusUpdater } from '../utils/locusUpdater';
import { APK_DOWNLOAD_STALL_TIMEOUT_MS } from './useAppUpdate';

// Settings -> Send LOCUS to someone: LOCUS downloads the installer itself, checks it, and
// opens Android's share sheet with the file. It used to hand the link to the phone's
// browser, whose download could sit at its last percent (its own safety scan, or no
// permission to open an APK) with LOCUS unable to see or help.
//
// Uses the same native downloader as the full update (LocusUpdaterPlugin): checksum and size
// checked natively, fails closed. Every attempt ends on READY (Send) or ERROR (Try again).

export const ShareStatus = {
  IDLE: 'idle',
  DOWNLOADING: 'downloading',
  // Every byte is saved; the size and checksum are being checked.
  VERIFYING: 'verifying',
  // Saved and checked. The share sheet has been opened; Send opens it again.
  READY: 'ready',
  ERROR: 'error',
};

/**
 * @param {object|null} installer a parseReleaseManifest manifest (version, apkUrl, apkSize, sha256)
 * @param {{enabled?: boolean, stallTimeoutMs?: number, shareTitle?: string}} options enabled:
 *   false (no native share, see canShareInstaller) leaves the native plugin alone;
 *   stallTimeoutMs is for tests
 */
export function useShareInstaller(installer, { enabled = true, stallTimeoutMs = APK_DOWNLOAD_STALL_TIMEOUT_MS, shareTitle } = {}) {
  const [status, setStatus] = useState(ShareStatus.IDLE);
  const [progress, setProgress] = useState({ percent: -1, loaded: 0, total: 0 });
  const [errorCode, setErrorCode] = useState(null);

  // Same pattern as useAppUpdate: one number per download, so a download given up on after
  // a stall can never move the screen when it answers late.
  const attemptRef = useRef(0);
  const downloadingRef = useRef(false);
  const stallTimerRef = useRef(null);
  const pathRef = useRef(null);
  const pathForRef = useRef(null);

  const clearStallTimer = useCallback(() => {
    clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  }, []);

  const fail = useCallback((code) => {
    setErrorCode(code);
    setStatus(ShareStatus.ERROR);
  }, []);

  const armStallTimer = useCallback(
    (attempt) => {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = setTimeout(() => {
        if (attempt !== attemptRef.current) return;
        attemptRef.current += 1;
        downloadingRef.current = false;
        stallTimerRef.current = null;
        // Native cancel deletes the partial file.
        LocusUpdater.cancelDownload().catch(() => {});
        fail('STALLED');
      }, stallTimeoutMs);
    },
    [fail, stallTimeoutMs]
  );

  /** Open the share sheet with the checked file. */
  const openShareSheet = useCallback(
    async (path) => {
      try {
        await LocusUpdater.shareFile({ path, title: shareTitle });
        setStatus(ShareStatus.READY);
      } catch (e) {
        // The file went (cache cleared, or the full update's download cleared the folder):
        // Try again downloads it afresh.
        pathRef.current = null;
        fail(e?.code === 'NOT_FOUND' ? 'IO_ERROR' : e?.code || 'SHARE_FAILED');
      }
    },
    [fail, shareTitle]
  );

  /** Send: share the checked file if there is one, otherwise download, check, then share. */
  const send = useCallback(async () => {
    if (!enabled || !installer || downloadingRef.current) return;
    if (pathRef.current && pathForRef.current === installer.apkUrl) {
      setErrorCode(null);
      await openShareSheet(pathRef.current);
      return;
    }

    const attempt = ++attemptRef.current;
    pathRef.current = null;
    setErrorCode(null);
    setProgress({ percent: -1, loaded: 0, total: installer.apkSize ?? 0 });
    setStatus(ShareStatus.DOWNLOADING);
    downloadingRef.current = true;
    armStallTimer(attempt);
    try {
      const { path } = await LocusUpdater.download({
        url: installer.apkUrl,
        sha256: installer.sha256,
        // What the person receiving it sees.
        fileName: `LOCUS-${installer.version}.apk`,
        ...(typeof installer.apkSize === 'number' && installer.apkSize > 0 ? { size: installer.apkSize } : {}),
      });
      if (attempt !== attemptRef.current) return;
      downloadingRef.current = false;
      clearStallTimer();
      pathRef.current = path;
      pathForRef.current = installer.apkUrl;
      await openShareSheet(path);
    } catch (e) {
      if (attempt !== attemptRef.current) return;
      downloadingRef.current = false;
      clearStallTimer();
      fail(e?.code || 'IO_ERROR');
    }
  }, [enabled, installer, armStallTimer, clearStallTimer, fail, openShareSheet]);

  useEffect(() => {
    if (!enabled) return undefined;
    let handle;
    let cancelled = false;
    LocusUpdater.addListener('downloadProgress', (event) => {
      if (!downloadingRef.current) return;
      armStallTimer(attemptRef.current);
      if (event?.stage === 'verifying') setStatus(ShareStatus.VERIFYING);
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
  }, [enabled, armStallTimer]);

  useEffect(() => clearStallTimer, [clearStallTimer]);

  return { status, progress, errorCode, send };
}
