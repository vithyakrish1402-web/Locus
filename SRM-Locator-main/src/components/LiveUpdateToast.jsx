import React from 'react';
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
const LiveUpdateToast = ({ live, aboveTabBar = false }) => {
  if (!live?.visible) return null;

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
