import React, { useEffect, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.button>, which this config can't see
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import BrandMark from '../access/BrandMark';
import { StatusDot } from '../ui';
import { SHARING_CHIP, TOP_BAR } from '../../copy/map';
import { TOP_BAR_HEIGHT, TOP_BAR_TOP } from '../../utils/mapChrome';

// The map screen's top bar: an ultra-clean, Apple-style floating island positioned on the
// left side of the screen on mobile, displaying the crisp "L.O.C.U.S" mark and essential actions.
/**
 * @param {{ isSatellite: boolean, query?: string, onQuery?: (text: string) => void,
 *   onSearchFocus?: (focused: boolean) => void }} props
 *   query / onQuery: the building search beside the name; omit onQuery for no search
 *   onSearchFocus: told when the search box gains or loses focus (the keyboard is up while it has it)
 */
export function TopBar({ isSatellite, query = '', onQuery, onSearchFocus }) {
  // Open while it holds text too, so a search never hides behind the icon.
  const [searching, setSearching] = useState(false);
  const open = searching || query.trim() !== '';
  // Unmounting the box fires no blur, so closing says the keyboard is gone itself.
  const close = () => {
    // Let go of the field first, so the keyboard goes with it and has nothing to come back for.
    if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.testid === 'top-bar-search') document.activeElement.blur();
    setSearching(false); onQuery?.(''); onSearchFocus?.(false);
  };
  const reduceMotion = useReducedMotion();
  // The field grows out of the bar on a spring and folds back into it; the magnifier turns into
  // the close mark as it goes. Only numbers are animated (a px width to 0), never a calc() or a
  // gap that pops when the field goes: the bar has no gap of its own, each part carries its own
  // spacing. With reduced motion it simply appears. The field may be narrower than that on a
  // narrow screen (it shrinks inside the bar's own width), and its text then ends in an ellipsis
  // instead of running into the close mark.
  const spring = reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 38, mass: 0.9 };
  const fieldWidth = Math.max(120, Math.min(208, (typeof window === 'undefined' ? 412 : window.innerWidth) - 232));
  return (
    <nav
      aria-label="Top bar"
      data-testid="top-bar"
      className="absolute left-3 z-[1000] flex items-center rounded-full glass-floating text-text font-ui px-3 py-1.5 pointer-events-auto transition-[border-color] duration-200 focus-within:border-accent/50 shadow-[0_4px_20px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)] border border-[var(--glass-border)]"
      style={{ top: TOP_BAR_TOP, minHeight: '44px', maxWidth: 'calc(100vw - 1.5rem)' }}
    >
      <div className="flex items-center gap-2 pl-0.5 pr-1 select-none shrink-0">
        <BrandMark size="small" />
        <p className="text-[13px] font-bold tracking-[0.14em] text-text font-ui">{TOP_BAR.name}</p>
        {/* Hidden screen-reader context preserved for map view status */}
        <span className="sr-only">{isSatellite ? TOP_BAR.satelliteView : TOP_BAR.mapView}</span>
      </div>
      {onQuery && (
        <>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="field"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: fieldWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={spring}
                className="overflow-hidden min-w-0"
              >
                {/* Plain text in the bar, not a second box inside it: the bar itself shows the focus. */}
                <input
                  type="search"
                  autoFocus
                  data-testid="top-bar-search"
                  aria-label={TOP_BAR.search}
                  placeholder={TOP_BAR.searchPlaceholder}
                  value={query}
                  onChange={(e) => onQuery(e.target.value)}
                  onFocus={() => onSearchFocus?.(true)}
                  onBlur={() => onSearchFocus?.(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  enterKeyHint="search"
                  className="block h-9 w-full min-w-0 border-0 bg-transparent p-0 pl-3 pr-1 font-ui text-[14px] text-text text-ellipsis placeholder:text-text-secondary placeholder:text-ellipsis outline-none focus:outline-none appearance-none [&::-webkit-search-cancel-button]:hidden"
                />
              </motion.div>
            )}
          </AnimatePresence>
          <button
            type="button"
            data-testid={open ? undefined : 'top-bar-search-open'}
            aria-label={open ? TOP_BAR.clearSearch : TOP_BAR.search}
            onClick={open ? close : () => setSearching(true)}
            className="relative shrink-0 w-9 h-9 rounded-full text-text hover:bg-sunken cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {/* Both marks stay in place and cross-fade, so nothing mounts or unmounts mid-turn. */}
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center"
              initial={false}
              animate={{ opacity: open ? 0 : 1, rotate: open ? -90 : 0, scale: open ? 0.6 : 1 }}
              transition={spring}
            >
              <Search size={18} />
            </motion.span>
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center text-text-secondary"
              initial={false}
              animate={{ opacity: open ? 1 : 0, rotate: open ? 0 : 90, scale: open ? 1 : 0.6 }}
              transition={spring}
            >
              <X size={18} />
            </motion.span>
          </button>
        </>
      )}
    </nav>
  );
}

const DOT = { ACTIVE: 'live', FROZEN: 'paused', GHOST: 'hidden' };

/**
 * The sharing chip under the top bar: displays the full text ("Sharing live with your group")
 * first, then smoothly slides/collapses to the side leaving only the pulsing green dot visible
 * across the map. Tapping the dot or chip toggles between the compact dot and the expanded label.
 *
 * @param {{ mode: 'ACTIVE'|'FROZEN'|'GHOST', waiting?: boolean, pausedNoSpot?: boolean }} props
 */
export function SharingChip({ mode, waiting = false, pausedNoSpot = false }) {
  const reduceMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);

  const key = waiting && mode === 'ACTIVE'
    ? 'waiting'
    : pausedNoSpot && mode === 'FROZEN'
      ? 'pausedNoSpot'
      : mode;

  // Auto-collapse to side dot after a 3.5s initial view
  useEffect(() => {
    const timer = setTimeout(() => {
      setCollapsed(true);
    }, 3500);
    return () => clearTimeout(timer);
  }, [key]);

  const dotStatus = key === 'waiting' ? 'waiting' : DOT[mode] ?? 'live';
  const labelText = SHARING_CHIP[key] ?? SHARING_CHIP.ACTIVE;

  return (
    <div className="flex pointer-events-auto">
      <motion.button
        type="button"
        data-testid="sharing-chip"
        data-mode={key}
        aria-label={labelText}
        title={labelText}
        onClick={() => setCollapsed(!collapsed)}
        layout={!reduceMotion}
        initial={false}
        animate={{
          width: 'auto',
          scale: 1,
        }}
        whileTap={{ scale: 0.96 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 380, damping: 30 }
        }
        className={`group relative inline-flex items-center gap-2.5 min-h-11 rounded-[1.375rem] glass-pill font-ui shadow-sm transition-colors duration-200 cursor-pointer select-none ${
          collapsed ? 'px-3.5 py-2.5' : 'px-4 py-2'
        }`}
      >
        <span className="relative flex items-center justify-center">
          <span
            className={`w-2.5 h-2.5 rounded-full transition-transform duration-200 group-hover:scale-110 ${
              dotStatus === 'live'
                ? 'bg-success shadow-[0_0_8px_rgba(30,123,60,0.5)]'
                : dotStatus === 'paused'
                  ? 'bg-warning shadow-[0_0_8px_rgba(143,84,0,0.4)]'
                  : dotStatus === 'waiting'
                    ? 'bg-border-control'
                    : 'border border-dashed border-border-control'
            }`}
            aria-hidden="true"
          />
        </span>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              key="label"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, width: 0, x: -8 }}
              animate={{ opacity: 1, width: 'auto', x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, width: 0, x: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden whitespace-nowrap text-label text-text font-medium"
            >
              {labelText}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
