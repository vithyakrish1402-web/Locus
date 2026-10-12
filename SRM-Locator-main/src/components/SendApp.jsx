import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Download, Link as LinkIcon, Share2 } from 'lucide-react';
import { Button, ProgressBar } from './ui';
import { SEND_APP } from '../copy/settings';
import { selectInstallerRelease } from '../utils/updateManifest';
import { copyText } from '../utils/clipboard';
import { canShareInstaller } from '../utils/locusUpdater';
import { ShareStatus, useShareInstaller } from '../hooks/useShareInstaller';
import { UpdateStatus, displayPercent } from '../hooks/useAppUpdate';
import { getReleases } from '../utils/releasesLookup';

// Settings -> More -> Send LOCUS to someone: hand LOCUS to someone else. Finds the installer for the version
// on this phone (see selectInstallerRelease), then either sends the file itself or copies
// its link to paste into a chat. The recipient's copy then updates itself like this one.
//
// Sending: LOCUS downloads and checks the installer, then opens Android's share sheet
// (useShareInstaller). An older app (v1.1.0, whose native side cannot share a file) and the
// web build hand the link to the browser instead, which Capacitor does for any address
// outside the app - the old way, whose download LOCUS cannot see.

const DAMAGED = new Set(['CHECKSUM_MISMATCH', 'SIZE_MISMATCH']);
const failureText = (code) =>
  DAMAGED.has(code) ? SEND_APP.failed.damaged : code === 'SHARE_FAILED' ? SEND_APP.failed.noShare : SEND_APP.failed.didntFinish;

const formatSize = (bytes) => (Number.isFinite(bytes) ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : null);

// The installer for this phone's version never changes within a launch, so this launch's
// shared releases list (utils/releasesLookup.js) always does; only a failed lookup asks again.
async function findInstaller() {
  const installed = Capacitor.isNativePlatform() ? (await CapacitorApp.getInfo().catch(() => null))?.version ?? null : null;
  const installer = selectInstallerRelease(await getReleases(), installed);
  if (!installer) throw new Error('No installer has been published');
  return installer;
}

// GitHub's hourly limit refills within the hour; a later time means the phone's clock is off.
const BUSY_TIME_SHOWN_WITHIN_MS = 60 * 60 * 1000;

/** The sentence for a failed lookup. */
function lookupFailure(e, now = Date.now()) {
  if (e?.code === 'RATE_LIMITED') {
    // A refill time already past (or far off, from a wrong clock) says nothing useful.
    const at = e.resetAt instanceof Date && e.resetAt.getTime() > now && e.resetAt.getTime() - now <= BUSY_TIME_SHOWN_WITHIN_MS ? e.resetAt : null;
    return SEND_APP.busy(at ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null);
  }
  return SEND_APP.error(e?.name === 'AbortError' ? 'GitHub took too long to answer' : e?.message || 'Lookup failed');
}

/**
 * @param {{ openUrl?: (url: string) => void }} props openUrl is injectable for tests; on
 *   the phone, navigating away from the app opens the phone's browser, which downloads.
 */
export default function SendApp({ openUrl = (url) => window.location.assign(url) }) {
  const [state, setState] = useState({ status: 'loading', installer: null, error: null });
  const [copied, setCopied] = useState(false);
  const [shareable] = useState(canShareInstaller);

  const lookup = useCallback(() => {
    setState({ status: 'loading', installer: null, error: null });
    findInstaller()
      .then((installer) => setState({ status: 'ready', installer, error: null }))
      .catch((e) => setState({ status: 'error', installer: null, error: lookupFailure(e) }));
  }, []);

  useEffect(() => {
    lookup();
  }, [lookup]);

  const { status, installer, error } = state;
  const share = useShareInstaller(installer, { enabled: shareable, shareTitle: SEND_APP.title });
  const sending = share.status === ShareStatus.DOWNLOADING || share.status === ShareStatus.VERIFYING;
  // 100% only once the file is saved and checked, as in the full update.
  const percent = share.status === ShareStatus.READY ? 100 : displayPercent(UpdateStatus.DOWNLOADING, share.progress.percent);
  const shareLine =
    share.status === ShareStatus.DOWNLOADING ? SEND_APP.downloading(percent)
    : share.status === ShareStatus.VERIFYING ? SEND_APP.checking
    : share.status === ShareStatus.READY ? SEND_APP.sent
    : null;

  const copyLink = async () => {
    if (!installer) return;
    const ok = await copyText(installer.apkUrl);
    setCopied(ok ? SEND_APP.copied : SEND_APP.copyFailed);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3 font-ui" data-testid="send-app">
      <p className="text-body text-text">{SEND_APP.title}</p>
      <p className="text-secondary text-text-secondary">
        {status === 'loading' && SEND_APP.loading}
        {status === 'ready' && (shareable ? SEND_APP.readyShare : SEND_APP.ready)(installer.version, formatSize(installer.apkSize))}
        {status === 'error' && <span className="text-warning">{error}</span>}
      </p>

      {shareable && (sending || share.status === ShareStatus.READY) && (
        <div className="flex flex-col gap-2">
          <ProgressBar percent={percent} />
          <p className="text-secondary text-text-secondary" role="status">{shareLine}</p>
          {share.status === ShareStatus.READY && <p className="text-secondary text-text-secondary">{SEND_APP.theirPhone}</p>}
        </div>
      )}
      {shareable && share.status === ShareStatus.ERROR && (
        <p className="text-secondary text-warning" role="alert">{failureText(share.errorCode)}</p>
      )}

      {status === 'error' ? (
        <Button variant="secondary" block onClick={lookup}>{SEND_APP.tryAgain}</Button>
      ) : (
        <div className="flex gap-3">
          {shareable ? (
            <Button variant="tonal" icon={Share2} className="flex-1" disabled={status !== 'ready' || sending} onClick={share.send}>
              {share.status === ShareStatus.ERROR ? SEND_APP.tryAgain : SEND_APP.send}
            </Button>
          ) : (
            <Button variant="tonal" icon={Download} className="flex-1" disabled={status !== 'ready'} onClick={() => openUrl(installer.apkUrl)}>
              {SEND_APP.download}
            </Button>
          )}
          <Button variant="secondary" icon={LinkIcon} className="flex-1" disabled={status !== 'ready'} onClick={copyLink}>
            {copied || SEND_APP.copyLink}
          </Button>
        </div>
      )}
    </div>
  );
}
