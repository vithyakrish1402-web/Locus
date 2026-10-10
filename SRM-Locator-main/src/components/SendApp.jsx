import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Download, Link as LinkIcon } from 'lucide-react';
import { Button } from './ui';
import { SEND_APP } from '../copy/settings';
import { selectInstallerRelease } from '../utils/updateManifest';
import { copyText } from '../utils/clipboard';

// Settings -> More -> Send LOCUS to someone: hand LOCUS to someone else. Finds the installer for the version
// on this phone (see selectInstallerRelease) and either downloads it - the link is handed
// to the phone's browser, which Capacitor does for any address outside the app - or copies
// its link to paste into a chat. The recipient's copy then updates itself like this one.

const REPO = import.meta.env?.VITE_UPDATE_REPO || 'vithyakrish1402-web/Locus';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const LOOKUP_TIMEOUT_MS = 15000;

const formatSize = (bytes) => (Number.isFinite(bytes) ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : null);

async function findInstaller() {
  const installed = Capacitor.isNativePlatform() ? (await CapacitorApp.getInfo().catch(() => null))?.version ?? null : null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const installer = selectInstallerRelease(await response.json(), installed);
    if (!installer) throw new Error('No installer has been published');
    return installer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ openUrl?: (url: string) => void }} props openUrl is injectable for tests; on
 *   the phone, navigating away from the app opens the phone's browser, which downloads.
 */
export default function SendApp({ openUrl = (url) => window.location.assign(url) }) {
  const [state, setState] = useState({ status: 'loading', installer: null, error: null });
  const [copied, setCopied] = useState(false);

  const lookup = useCallback(() => {
    setState({ status: 'loading', installer: null, error: null });
    findInstaller()
      .then((installer) => setState({ status: 'ready', installer, error: null }))
      .catch((e) => setState({ status: 'error', installer: null, error: e?.name === 'AbortError' ? 'GitHub took too long to answer' : e?.message || 'Lookup failed' }));
  }, []);

  useEffect(() => {
    lookup();
  }, [lookup]);

  const { status, installer, error } = state;

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
        {status === 'ready' && SEND_APP.ready(installer.version, formatSize(installer.apkSize))}
        {status === 'error' && <span className="text-warning">{SEND_APP.error(error)}</span>}
      </p>

      {status === 'error' ? (
        <Button variant="secondary" block onClick={lookup}>{SEND_APP.tryAgain}</Button>
      ) : (
        <div className="flex gap-3">
          <Button variant="tonal" icon={Download} className="flex-1" disabled={status !== 'ready'} onClick={() => openUrl(installer.apkUrl)}>
            {SEND_APP.download}
          </Button>
          <Button variant="secondary" icon={LinkIcon} className="flex-1" disabled={status !== 'ready'} onClick={copyLink}>
            {copied || SEND_APP.copyLink}
          </Button>
        </div>
      )}
    </div>
  );
}
