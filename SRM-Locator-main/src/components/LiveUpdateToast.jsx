import React, { useEffect, useState } from 'react';
import { LiveUpdateStatus } from '../hooks/useLiveUpdate';

// Phase 2 surface: a bottom-anchored strip, not a modal. A JS bundle swap is far less
// consequential than a full APK install, and it is already downloaded and verified by
// the time this appears — so it should not take the screen the way UpdateModal does.
//
// z-[6500]: above every in-app panel (App.jsx tops out at 6000) but far below
// UpdateModal (10000) and SosOverlay (10002), both of which must win over it.

// aboveTabBar: on the phone's map screen the strip sits above the bottom tab bar AND the
// floating SOS and targeting buttons over it (10.5rem clears all three). It used to be drawn
// over the bar, hiding GRID/SCAN/SQUAD until it was dismissed, and must never cover SOS.
//
// The strip also steps aside while it would cover what someone is working with (found on the
// phone): while a text field has focus, since the keyboard pushes it up over the field's own
// button (CONNECT TO SQUAD), and - via `hidden` - while the squad sheet is open over the map,
// where it covered the roster. It is never urgent; it comes back as soon as they're done.
const isTextEntry = (el) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'range'].includes(el.type)));

function useTyping() {
  const [typing, setTyping] = useState(() => typeof document !== 'undefined' && isTextEntry(document.activeElement));
  useEffect(() => {
    const update = () => setTyping(isTextEntry(document.activeElement));
    const onFocusOut = () => setTimeout(update, 0); // activeElement settles after focusout
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);
  // A focused field that is removed from the page (the join box, the moment Enter joins the
  // squad) fires no blur in Chrome, so "typing" would stick until the next tap - found on the
  // phone. While typing, check that the field still exists.
  useEffect(() => {
    if (!typing) return undefined;
    const id = setInterval(() => {
      const el = document.activeElement;
      if (!el || !el.isConnected || !isTextEntry(el)) setTyping(false);
    }, 500);
    return () => clearInterval(id);
  }, [typing]);
  return typing;
}

/** Whole seconds since `startedAt`, ticking once a second while `running`. */
function useElapsed(startedAt, running) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

/**
 * The download's bar: filled to the plugin's percent once it reports one, and until then
 * a sliding sweep, so a phone waiting on its first byte still visibly works.
 */
function DownloadBar({ percent }) {
  const known = Number.isFinite(percent);
  return (
    <div
      role="progressbar"
      aria-label="Update download"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? percent : undefined}
      className="relative mt-3 h-1 w-full overflow-hidden bg-white/10"
    >
      {known ? (
        <div className="h-full bg-red-500 transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
      ) : (
        <div data-testid="download-sweep" className="locus-download-sweep absolute inset-y-0 w-1/3 bg-red-500" />
      )}
    </div>
  );
}

const LiveUpdateToast = ({ live, aboveTabBar = false, hidden = false }) => {
  const typing = useTyping();
  const [restarting, setRestarting] = useState(false);
  // Only read the status once the strip is showing at all, as before this existed.
  const downloading = Boolean(live?.visible) && live.status === LiveUpdateStatus.DOWNLOADING;
  const elapsed = useElapsed(live?.download?.startedAt, downloading);
  if (!live?.visible || hidden || typing) return null;

  const blocked = live.status === LiveUpdateStatus.BLOCKED;
  const failed = live.status === LiveUpdateStatus.ERROR;
  const version = live.manifest?.version;
  const percent = live.download?.percent;
  const title = downloading ? 'UPDATING' : failed ? 'UPDATE FAILED' : blocked ? 'UPDATE BLOCKED' : 'UPDATE READY';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 z-[6500] flex justify-center px-4 pb-6 pointer-events-none ${
        aboveTabBar ? 'bottom-[calc(10.5rem+env(safe-area-inset-bottom))] md:bottom-0' : 'bottom-0'
      }`}
    >
      <div className="pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-3 border border-white/20 bg-black px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="font-dot text-[10px] uppercase tracking-widest text-red-500">
            {/* Nothing is applied until RESTART is tapped. */}
            {title}
            {downloading && (
              <span className="ml-2 text-zinc-500">
                {Number.isFinite(percent) ? `${percent}%` : 'PREPARING'} · {elapsed}S
              </span>
            )}
          </div>
          <p className="mt-1 font-inter text-[12px] leading-snug text-zinc-400">
            {downloading ? (
              <>Downloading version {version}. Keep LOCUS open until it&apos;s ready - closing it stops the download.</>
            ) : failed ? (
              <>
                Version {version} didn&apos;t install{live.error?.message ? ` (${live.error.message})` : ''}. LOCUS
                will try again next time you open it.
              </>
            ) : blocked ? (
              <>
                Bundle {live.manifest?.version} needs app version {live.manifest?.minNative} or newer. Install the
                full update first.
              </>
            ) : (
              <>Version {live.manifest?.version} is ready. Restart to use it.</>
            )}
          </p>
          {downloading && <DownloadBar percent={percent} />}
        </div>
        {live.status === LiveUpdateStatus.READY && (
          <button
            type="button"
            disabled={restarting}
            onClick={() => {
              setRestarting(true);
              live.applyNow();
            }}
            className="font-dot text-[10px] uppercase tracking-widest px-4 py-2.5 border border-red-500 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-60"
          >
            {restarting ? 'Restarting...' : 'Restart'}
          </button>
        )}
        <button
          type="button"
          onClick={live.dismiss}
          aria-label="Dismiss update notice"
          className="font-dot text-[10px] uppercase tracking-widest px-3 py-2.5 border border-white/20 text-zinc-500 hover:border-white/40 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default LiveUpdateToast;
