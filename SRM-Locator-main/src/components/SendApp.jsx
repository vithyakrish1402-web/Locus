import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Download, Link as LinkIcon, Send } from 'lucide-react';
import { selectInstallerRelease } from '../utils/updateManifest';
import { copyText } from '../utils/clipboard';

// SYS_CONFIG -> SEND_APP: hand LOCUS to someone else. Finds the installer for the version
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
    setCopied(ok ? 'COPIED' : 'COPY FAILED');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4" data-testid="send-app">
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <Send size={16} className="text-emerald-400" />
        <span className="font-dot text-xs uppercase tracking-widest text-zinc-400">SEND_APP</span>
      </div>

      <p className="font-inter text-[11px] text-zinc-400 leading-snug">
        {status === 'loading' && 'Finding the installer...'}
        {status === 'ready' && (
          <>
            LOCUS v{installer.version}
            {formatSize(installer.apkSize) ? ` · ${formatSize(installer.apkSize)}` : ''}. Download the installer to pass it on,
            or copy its link into a chat. It keeps itself up to date once installed.
          </>
        )}
        {status === 'error' && <span className="text-yellow-500">Couldn&apos;t find the installer: {error}.</span>}
      </p>

      {status === 'error' ? (
        <button
          type="button"
          onClick={lookup}
          className="w-full py-3 font-dot text-xs uppercase tracking-widest border border-white/20 text-zinc-300 hover:border-white/50 transition-colors"
        >
          TRY AGAIN
        </button>
      ) : (
        <div className="flex gap-4">
          <button
            type="button"
            disabled={status !== 'ready'}
            onClick={() => openUrl(installer.apkUrl)}
            className="flex-1 py-3 font-dot text-xs uppercase tracking-widest border flex items-center justify-center gap-2 transition-colors bg-emerald-500/15 text-emerald-400 border-emerald-500 hover:bg-emerald-500/25 disabled:opacity-40"
          >
            <Download size={14} /> DOWNLOAD APK
          </button>
          <button
            type="button"
            disabled={status !== 'ready'}
            onClick={copyLink}
            className="flex-1 py-3 font-dot text-xs uppercase tracking-widest border flex items-center justify-center gap-2 transition-colors bg-black text-zinc-300 border-white/20 hover:border-white/50 disabled:opacity-40"
          >
            <LinkIcon size={14} /> {copied || 'COPY LINK'}
          </button>
        </div>
      )}
    </div>
  );
}
