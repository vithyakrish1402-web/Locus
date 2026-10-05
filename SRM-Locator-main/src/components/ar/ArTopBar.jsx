import React, { useEffect, useRef } from 'react';
import { ChevronDown, Crosshair, RotateCcw, X } from 'lucide-react';
import { AR_CONTROLS } from '../../copy/arScan';

// AR Scan's top controls (redesign AR Scan batch, piece 3): Close, the "Finding Tech Park"
// pill (it opens the target picker), and ALIGN in a small round button under it, with Reset
// beside it only once an alignment is in use. A long press on the pill (and nothing shorter)
// opens and closes the debug overlay; an ordinary tap never does, and a long press never also
// counts as a tap.

export const DEBUG_LONG_PRESS_MS = 700;

const ROUND = 'ar-plate inline-flex items-center justify-center w-12 h-12 rounded-full text-text shadow-[var(--shadow-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * @param {{ targetName: string, onClose: () => void, onPick?: (() => void)|null,
 *   onAlign: () => void, aligned: boolean, onReset: () => void, onDebug: () => void }} props
 *   onPick: opens the target picker; without it the pill is a label only
 */
export default function ArTopBar({ targetName, onClose, onPick = null, onAlign, aligned, onReset, onDebug }) {
  const timer = useRef(null);
  const longPressed = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pressStart = () => {
    longPressed.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      longPressed.current = true;
      onDebug();
    }, DEBUG_LONG_PRESS_MS);
  };
  const pressEnd = () => clearTimeout(timer.current);
  const pillEvents = {
    onPointerDown: pressStart,
    onPointerUp: pressEnd,
    onPointerLeave: pressEnd,
    onPointerCancel: pressEnd,
    onContextMenu: (e) => e.preventDefault(),
  };

  const pillBody = (
    <>
      <span className="flex-1 min-w-0 text-left leading-tight">
        <span className="block text-secondary text-text-secondary">{AR_CONTROLS.finding}</span>
        <span className="block text-heading truncate">{targetName}</span>
      </span>
      {onPick && <ChevronDown size={22} aria-hidden="true" className="shrink-0 text-text-secondary" />}
    </>
  );
  const pillClass = 'ar-plate flex-1 min-w-0 min-h-14 flex items-center gap-2 rounded-full px-5 py-2 text-text font-ui shadow-[var(--shadow-2)] select-none';

  return (
    <div data-testid="ar-top-bar" className="flex flex-col gap-3 font-ui">
      <div className="flex items-center gap-3">
        <button type="button" className={ROUND} onClick={onClose} aria-label={AR_CONTROLS.close} title={AR_CONTROLS.close}>
          <X size={24} aria-hidden="true" />
        </button>
        {onPick ? (
          <button
            type="button"
            data-testid="ar-target-pill"
            className={`${pillClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
            aria-label={AR_CONTROLS.chooseTarget(targetName)}
            {...pillEvents}
            // A long press opened the debug overlay: that press is not also a tap.
            onClick={() => { if (longPressed.current) { longPressed.current = false; return; } onPick(); }}
          >
            {pillBody}
          </button>
        ) : (
          <div data-testid="ar-target-pill" className={pillClass} {...pillEvents}>{pillBody}</div>
        )}
      </div>
      <div className="flex justify-end gap-3">
        {aligned && (
          <span className="flex flex-col items-center gap-1">
            <button type="button" className={ROUND} onClick={onReset} aria-label={AR_CONTROLS.resetLabel} title={AR_CONTROLS.resetLabel}>
              <RotateCcw size={20} aria-hidden="true" />
            </button>
            <span className="ar-plate rounded-full px-2 text-caption text-text" aria-hidden="true">{AR_CONTROLS.reset}</span>
          </span>
        )}
        <span className="flex flex-col items-center gap-1">
          <button type="button" className={ROUND} onClick={onAlign} aria-label={AR_CONTROLS.alignLabel} title={AR_CONTROLS.alignLabel}>
            <Crosshair size={20} aria-hidden="true" />
          </button>
          <span className="ar-plate rounded-full px-2 text-caption text-text" aria-hidden="true">{AR_CONTROLS.align}</span>
        </span>
      </div>
    </div>
  );
}
