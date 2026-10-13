import React, { useEffect, useState } from 'react';
import { LogOut, ShieldAlert, Sliders } from 'lucide-react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.button>, which this config can't see
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import BrandMark from '../access/BrandMark';
import { IconButton, StatusDot } from '../ui';
import { SHARING_CHIP, TOP_BAR } from '../../copy/map';
import { TOP_BAR_HEIGHT, TOP_BAR_TOP } from '../../utils/mapChrome';
import { SETTINGS } from '../../copy/settings';

// The map screen's top bar: an ultra-clean, Apple-style floating island positioned on the
// left side of the screen on mobile, displaying the crisp "L.O.C.U.S" mark and essential actions.
export function TopBar({ isSatellite, onSignOut, onSettings, isAdmin = false, onAdmin }) {
  return (
    <nav
      aria-label="Top bar"
      data-testid="top-bar"
      className="absolute left-3 z-[1000] flex items-center gap-2 rounded-full glass-floating text-text font-ui px-2.5 py-1.5 pointer-events-auto transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)] border border-[var(--glass-border)]"
      style={{ top: TOP_BAR_TOP, minHeight: '44px' }}
    >
      <div className="flex items-center gap-2 pl-0.5 pr-1.5 select-none">
        <BrandMark size="small" />
        <p className="text-[13px] font-bold tracking-[0.14em] text-text font-ui">{TOP_BAR.name}</p>
        {/* Hidden screen-reader context preserved for map view status */}
        <span className="sr-only">{isSatellite ? TOP_BAR.satelliteView : TOP_BAR.mapView}</span>
      </div>

      <div className="flex items-center gap-0.5 border-l border-[var(--glass-border-subtle)] pl-1">
        {isAdmin && (
          <IconButton
            label="Admin settings"
            icon={ShieldAlert}
            size={16}
            onClick={onAdmin}
            className="!min-w-[32px] !min-h-[32px] text-text-secondary hover:text-text hover:bg-black/5 dark:hover:bg-white/10"
          />
        )}
        <IconButton
          label={SETTINGS.open}
          icon={Sliders}
          size={16}
          onClick={onSettings}
          className="!min-w-[32px] !min-h-[32px] text-text-secondary hover:text-text hover:bg-black/5 dark:hover:bg-white/10"
        />
        <IconButton
          label={TOP_BAR.signOut}
          icon={LogOut}
          size={16}
          onClick={onSignOut}
          className="!min-w-[32px] !min-h-[32px] text-text-secondary hover:text-text hover:bg-black/5 dark:hover:bg-white/10"
        />
      </div>
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
