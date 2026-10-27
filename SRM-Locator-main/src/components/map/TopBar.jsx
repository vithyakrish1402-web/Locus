import React, { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.button>, which this config can't see
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import BrandMark from '../access/BrandMark';
import { StatusDot } from '../ui';
import { SHARING_CHIP, SHARING_CHIP_SHORT, TOP_BAR } from '../../copy/map';
import { TOP_BAR_HEIGHT, TOP_BAR_TOP } from '../../utils/mapChrome';

/** How long the sharing chip stays open on its text, once it has opened, before folding to its dot. */
export const STATUS_PILL_EXPAND_HOLD_MS = 3500;
/**
 * How long a new state must last before the chip opens again to announce it. A state that
 * comes and goes in less than this (a GPS fix lost and found again) is not an event worth
 * announcing: it never opens the chip, so it cannot make it flicker.
 */
export const STATUS_PILL_EVENT_SETTLE_MS = 800;
/** How long the label takes to fade; the chip changes width only while the label is fully faded. */
const LABEL_FADE_MS = 140;

// The map screen's top bar: an ultra-clean, Apple-style floating island positioned on the
// left side of the screen on mobile, displaying the crisp "L.O.C.U.S" mark and essential actions.
/**
 * @param {{ isSatellite: boolean, query?: string, onQuery?: (text: string) => void,
 *   onSearchFocus?: (focused: boolean) => void, fade?: import('framer-motion').MotionValue<number>,
 *   inert?: boolean }} props
 *   query / onQuery: the building search beside the name; omit onQuery for no search
 *   onSearchFocus: told when the search box gains or loses focus (the keyboard is up while it has it)
 *   fade: its opacity, from the phone's Buildings / Group panel as it rises over the bar;
 *   inert: while that panel is open
 */
export function TopBar({ isSatellite, query = '', onQuery, onSearchFocus, fade, inert = false }) {
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
    <motion.nav
      aria-label="Top bar"
      data-testid="top-bar"
      inert={inert}
      className="absolute left-3 z-[1000] flex items-center rounded-full glass-floating text-text font-ui px-3 py-1.5 pointer-events-auto transition-[border-color] duration-200 focus-within:border-accent/50 shadow-[0_4px_20px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)] border border-[var(--glass-border)]"
      style={{ top: TOP_BAR_TOP, minHeight: '44px', maxWidth: 'calc(100vw - 1.5rem)', ...(fade ? { opacity: fade } : {}) }}
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
    </motion.nav>
  );
}

const DOT = { ACTIVE: 'live', FROZEN: 'paused', GHOST: 'hidden' };

/**
 * The sharing chip under the top bar: opens on its text ("Sharing live with your group") when
 * the map appears and whenever what it says changes for real, holds for STATUS_PILL_EXPAND_HOLD_MS,
 * then folds to the pulsing dot. Tapping it toggles between the dot and the text.
 *
 * It stays mounted when it is hidden (a banner is in its place): hiding it only draws nothing, so
 * its state is not lost and it does not open afresh every time the banner goes. The label never
 * shows cut off: it fades out before the chip narrows, and the chip widens before it fades in.
 *
 * @param {{ mode: 'ACTIVE'|'FROZEN'|'GHOST', waiting?: boolean, pausedNoSpot?: boolean, hidden?: boolean }} props
 */
export function SharingChip({ mode, waiting = false, pausedNoSpot = false, hidden = false }) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(true);
  const firstRef = useRef(true);

  const key = waiting && mode === 'ACTIVE'
    ? 'waiting'
    : pausedNoSpot && mode === 'FROZEN'
      ? 'pausedNoSpot'
      : mode;

  // Opens on the first view and on each real change of what it says, then folds after the hold.
  useEffect(() => {
    let hold;
    const open = () => {
      setExpanded(true);
      hold = setTimeout(() => setExpanded(false), STATUS_PILL_EXPAND_HOLD_MS);
    };
    let settle;
    if (firstRef.current) {
      firstRef.current = false;
      open();
    } else {
      settle = setTimeout(open, STATUS_PILL_EVENT_SETTLE_MS);
    }
    return () => { clearTimeout(settle); clearTimeout(hold); };
  }, [key]);

  // Folded, a one-word name stays beside the dot (it used to be a bare dot nobody could read). It
  // comes only once the long label has faded and its room has gone, so the chip never holds both.
  const fadeMs = reduceMotion ? 0 : LABEL_FADE_MS;
  const [showShort, setShowShort] = useState(false);
  useEffect(() => {
    if (expanded) return undefined;
    const after = setTimeout(() => setShowShort(true), fadeMs);
    return () => { clearTimeout(after); setShowShort(false); };
  }, [expanded, fadeMs]);

  if (hidden) return null;

  const dotStatus = key === 'waiting' ? 'waiting' : DOT[mode] ?? 'live';
  const labelText = SHARING_CHIP[key] ?? SHARING_CHIP.ACTIVE;
  const fade = reduceMotion ? 0 : LABEL_FADE_MS;
  // Open: the room for the text appears at once, and the text fades in. Folding: the text fades
  // out, and only then does the room go.
  const labelStyle = expanded
    ? { gridTemplateColumns: '1fr', opacity: 1, transition: `grid-template-columns 0s, opacity ${fade}ms ease` }
    : { gridTemplateColumns: '0fr', opacity: 0, transition: `opacity ${fade}ms ease, grid-template-columns 0s linear ${fade}ms` };

  return (
    <div className="flex pointer-events-auto">
      <motion.button
        type="button"
        data-testid="sharing-chip"
        data-mode={key}
        data-expanded={expanded ? 'true' : 'false'}
        aria-label={labelText}
        title={labelText}
        onClick={() => setExpanded((open) => !open)}
        whileTap={{ scale: 0.96 }}
        className={`group relative inline-flex items-center max-w-full min-h-11 rounded-[1.375rem] glass-pill font-ui shadow-sm transition-colors duration-200 cursor-pointer select-none ${
          expanded ? 'px-4 py-2' : 'px-3.5 py-2.5'
        }`}
      >
        <span className="relative flex items-center justify-center shrink-0">
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

        <span className="grid min-w-0" style={labelStyle}>
          <span className="overflow-hidden min-w-0">
            <span className="block pl-2.5 whitespace-nowrap truncate text-label text-text font-medium">{labelText}</span>
          </span>
        </span>
        {!expanded && showShort && (
          <span
            data-testid="sharing-chip-short"
            aria-hidden="true"
            className="pl-2 whitespace-nowrap text-label text-text font-medium"
            style={fadeMs ? { animation: `locus-member-fade-in ${fadeMs}ms ease both` } : undefined}
          >
            {SHARING_CHIP_SHORT[key] ?? SHARING_CHIP_SHORT.ACTIVE}
          </span>
        )}
      </motion.button>
    </div>
  );
}
