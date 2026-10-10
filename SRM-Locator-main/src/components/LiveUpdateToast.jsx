import React, { useEffect, useState } from 'react';
import { AlertCircle, Download, RefreshCw, X } from 'lucide-react';
import { LiveUpdateStatus } from '../hooks/useLiveUpdate';
import { Button, IconButton } from './ui';
import { LIVE_UPDATE } from '../copy/updates';

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
      aria-label={LIVE_UPDATE.bar}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? percent : undefined}
      className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      {known ? (
        // Full width, scaled from the left edge: a transform, not a width animation.
        <div className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${percent / 100})` }} />
      ) : (
        <div data-testid="download-sweep" className="locus-download-sweep absolute inset-y-0 w-1/3 rounded-full bg-accent" />
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
  const look = downloading ? LIVE_UPDATE.downloading : failed ? LIVE_UPDATE.failed : blocked ? LIVE_UPDATE.blocked : LIVE_UPDATE.ready;
  const body = downloading
    ? look.body(version)
    : failed
      ? look.body(version, live.error?.message)
      : blocked
        ? look.body(live.manifest?.version, live.manifest?.minNative)
        : look.body(live.manifest?.version);
  const Icon = failed || blocked ? AlertCircle : downloading ? Download : RefreshCw;
  const tone = failed || blocked ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 z-[6500] flex justify-center px-3 pb-4 pointer-events-none ${
        aboveTabBar ? 'bottom-[calc(10.5rem+env(safe-area-inset-bottom))] md:bottom-0' : 'bottom-0'
      }`}
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-card border border-border bg-raised text-text font-ui shadow-[var(--shadow-2)] py-3 pl-3 pr-1">
        <span className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${tone}`} aria-hidden="true">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-heading">
            {/* Nothing is applied until Restart is tapped. */}
            {look.title}
            {downloading && (
              <span className="ml-2 text-secondary text-text-secondary">
                {Number.isFinite(percent) ? `${percent}%` : LIVE_UPDATE.downloading.preparing} · {LIVE_UPDATE.downloading.elapsed(elapsed)}
              </span>
            )}
          </p>
          <p className="text-secondary text-text-secondary">{body}</p>
          {downloading && <DownloadBar percent={percent} />}
        </div>
        {live.status === LiveUpdateStatus.READY && (
          <Button
            disabled={restarting}
            onClick={() => {
              setRestarting(true);
              live.applyNow();
            }}
            className="shrink-0"
          >
            {restarting ? LIVE_UPDATE.restarting : LIVE_UPDATE.restart}
          </Button>
        )}
        <IconButton label={LIVE_UPDATE.dismiss} icon={X} size={20} onClick={live.dismiss} className="shrink-0" />
      </div>
    </div>
  );
};

export default LiveUpdateToast;
