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

const LiveUpdateToast = ({ live, aboveTabBar = false, hidden = false }) => {
  const typing = useTyping();
  if (!live?.visible || hidden || typing) return null;

  const blocked = live.status === LiveUpdateStatus.BLOCKED;

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
            {blocked ? 'UPDATE BLOCKED' : 'UPDATE READY'}
          </div>
          <p className="mt-1 font-inter text-[12px] leading-snug text-zinc-400">
            {blocked ? (
              <>
                Bundle {live.manifest?.version} needs app version {live.manifest?.minNative} or newer. Install the
                full update first.
              </>
            ) : (
              <>Version {live.manifest?.version} is ready. Restart to use it.</>
            )}
          </p>
        </div>
        {!blocked && (
          <button
            type="button"
            onClick={live.applyNow}
            className="font-dot text-[10px] uppercase tracking-widest px-4 py-2.5 border border-red-500 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Restart
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
