import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { PANEL_SPRING } from '../../utils/motion';
import {
  MapPin,
  CheckCircle2,
  X,
  AlertTriangle,
  RefreshCw,
  LocateFixed,
  Crosshair,
} from 'lucide-react';

// Navigation overlay settings.
export const NAV_PANEL_MAX_TEXT_LINES = 2; // instruction and THEN text wrap to this many lines
export const NAV_SHOW_ARRIVAL_TIME = true; // the arrival clock time in the summary strip

/**
 * Turn arrows
 */
export function ManeuverIcon({ maneuver, size = 32, className = '' }) {
  const s = size;
  switch (maneuver) {
    case 'turn-left':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M10 13L4 18L10 23" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 18H18C23.5228 18 28 22.4772 28 28V30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'turn-right':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M22 13L28 18L22 23" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M27 18H14C8.47715 18 4 22.4772 4 28V30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'turn-slight-left':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M9 9H18M9 9V18M9 9L23 23" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'turn-slight-right':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M23 9H14M23 9V18M23 9L9 23" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'turn-sharp-left':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M11 23L5 28L4 21" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 27L17 15C20.3137 11.6863 25.6863 11.6863 29 15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'turn-sharp-right':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M21 23L27 28L28 21" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M27 27L15 15C11.6863 11.6863 6.31371 11.6863 3 15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'uturn':
    case 'uturn-left':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M10 20L4 15L10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 15H19C23.9706 15 28 19.0294 28 24V29" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'uturn-right':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M22 20L28 15L22 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M27 15H13C8.02944 15 4 19.0294 4 24V29" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case 'arrive':
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M16 4C10.4772 4 6 8.47715 6 14C6 21 16 29 16 29C16 29 26 21 26 14C26 8.47715 21.5228 4 16 4Z" fill="currentColor" />
          <circle cx="16" cy="14" r="4" style={{ fill: 'var(--color-surface)' }} />
        </svg>
      );
    case 'straight':
    case 'depart':
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none" className={className}>
          <path d="M16 5V27M16 5L8 13M16 5L24 13" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

const fmtDistance = (m, digits = 1) =>
  m > 1000 ? `${(m / 1000).toFixed(digits)} km` : `${Math.round(m || 0)} m`;

// Wraps to at most NAV_PANEL_MAX_TEXT_LINES lines, then ends with an ellipsis only if it
// really is longer than that.
const clampLines = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: NAV_PANEL_MAX_TEXT_LINES,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
};

/**
 * The one navigation panel, at the top of the map: the next turn, the step after it, and
 * a summary strip (minutes left, distance left, arrival time, destination). The close
 * button ends navigation. Colours, font and corners come from the theme tokens
 * (src/theme/tokens.css), so it follows light/dark and any future accent change.
 */
export function TurnInstructionCard({
  currentStep,
  nextStep,
  distanceToNextMeters,
  isRerouting,
  rerouteError,
  onRetryReroute,
  onEnd,
  destinationName,
  remainingMeters,
  remainingMinutes,
}) {
  const reduceMotion = useReducedMotion();
  const distText = fmtDistance(distanceToNextMeters);
  const instruction = currentStep?.instruction || `Head to ${destinationName || 'destination'}`;

  const summaryLoading = !remainingMeters && !remainingMinutes;
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const arrivalTime = useMemo(
    () =>
      new Date(currentTime + Math.max(1, remainingMinutes || 1) * 60000).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [currentTime, remainingMinutes],
  );

  return (
    <div
      data-testid="turn-instruction-card"
      className="w-full overflow-hidden rounded-card border border-border bg-surface text-text shadow-[var(--shadow-2)] font-ui pointer-events-auto"
    >
      <div className="flex items-start gap-3 px-3 pt-3 pb-2.5">
        {/* Turn arrow and the distance to it */}
        <div className="flex min-w-[64px] shrink-0 flex-col items-center gap-1">
          {isRerouting ? (
            <RefreshCw size={30} className="my-1.5 animate-spin text-accent" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-fill border border-border bg-accent-soft text-accent">
              <ManeuverIcon maneuver={currentStep?.maneuver || 'straight'} size={30} />
            </div>
          )}
          <span className="text-numeric tabular-nums">{distText}</span>
        </div>

        {/* The instruction */}
        <div className="min-w-0 flex-1 pt-0.5">
          {isRerouting ? (
            <>
              <p className="text-title animate-pulse">Recalculating…</p>
              <p className="text-caption text-text-secondary">Finding the best walking path</p>
            </>
          ) : rerouteError ? (
            <>
              <p className="text-title flex items-center gap-1.5 text-warning">
                <AlertTriangle size={18} /> Off route
              </p>
              <button
                type="button"
                onClick={onRetryReroute}
                className="mt-1 min-h-11 text-label text-accent underline"
              >
                Tap to recalculate route
              </button>
            </>
          ) : !currentStep ? (
            <>
              <p className="text-title flex animate-pulse items-center gap-2">
                <LocateFixed size={18} className="text-accent" /> Acquiring GPS…
              </p>
              <p className="text-caption text-text-secondary" style={clampLines}>
                Navigating to {destinationName || 'destination'}
              </p>
            </>
          ) : (
            <h2 data-testid="nav-instruction" className="text-[1.0625rem] font-semibold leading-snug" style={clampLines}>
              {instruction}
            </h2>
          )}
        </div>

        {/* End navigation */}
        <button
          type="button"
          onClick={onEnd}
          aria-label="End route"
          title="Exit navigation"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-fill border border-border-control text-text-secondary transition-transform active:scale-95 hover:text-text"
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      </div>

      {/* The step after this one */}
      <AnimatePresence initial={false}>
        {nextStep && !isRerouting && (
          <motion.div
            key="then"
            data-testid="nav-then-row"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={PANEL_SPRING}
            style={{ overflow: 'hidden' }}
          >
            <div className="flex items-start gap-2.5 border-t border-border bg-bg px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded-fill border border-border px-1.5 py-0.5 text-caption uppercase tracking-wider text-text-secondary">
                Then
              </span>
              <ManeuverIcon maneuver={nextStep.maneuver || 'straight'} size={20} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 text-secondary" style={clampLines}>
                {nextStep.instruction || destinationName}
              </span>
              {nextStep.distanceMeters > 0 && (
                <span className="mt-0.5 shrink-0 text-caption tabular-nums text-text-secondary">
                  {fmtDistance(nextStep.distanceMeters)}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trip summary: one line of numbers, then where you are going */}
      <div data-testid="navigation-summary" className="border-t border-border px-3 py-2">
        {summaryLoading ? (
          <p className="text-label animate-pulse text-text-secondary">Calculating walking time…</p>
        ) : (
          <p className="text-label flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
            <span className="text-accent">{remainingMinutes} min</span>
            <span aria-hidden="true" className="text-text-secondary">·</span>
            <span>{fmtDistance(remainingMeters, 2)}</span>
            {NAV_SHOW_ARRIVAL_TIME && (
              <>
                <span aria-hidden="true" className="text-text-secondary">·</span>
                <span>{arrivalTime}</span>
              </>
            )}
          </p>
        )}
        <p className="mt-0.5 flex items-center gap-1.5 text-caption text-text-secondary">
          <MapPin size={13} className="shrink-0 text-accent" />
          <span className="min-w-0 truncate">
            Walking to <strong className="font-semibold text-text">{destinationName || 'Destination'}</strong>
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * Auto-follow toggle and Re-center, bottom right (the bottom card they used to sit above is
 * gone). Theme colours, the theme's small corner radius, 44 px touch targets.
 */
export function RecenterButton({ onClick, autoFollow = false, onToggleAutoFollow }) {
  return (
    <div
      className="fixed right-4 z-[900] flex items-center gap-2 pointer-events-auto"
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {onToggleAutoFollow && (
        <button
          type="button"
          onClick={onToggleAutoFollow}
          aria-label={autoFollow ? 'Disable auto-centering' : 'Enable auto-centering'}
          title={autoFollow ? 'Auto-centering is ON' : 'Auto-centering is OFF (Manual recenter)'}
          className={`min-h-11 rounded-fill border px-3.5 text-label uppercase tracking-wider shadow-[var(--shadow-2)] transition-[transform,background-color,color] duration-150 active:scale-95 ${
            autoFollow
              ? 'border-accent bg-accent text-accent-on'
              : 'border-border-control bg-surface text-text-secondary'
          }`}
        >
          {autoFollow ? 'Auto: ON' : 'Auto: OFF'}
        </button>
      )}
      <button
        type="button"
        onClick={onClick}
        data-testid="nav-recenter-button"
        aria-label="Re-center navigation"
        className="inline-flex min-h-11 items-center gap-2 rounded-fill border border-border-control bg-surface px-3.5 text-label uppercase tracking-wider text-text shadow-[var(--shadow-2)] transition-transform active:scale-95"
      >
        <Crosshair size={18} className="text-accent" />
        <span>Re-center</span>
      </button>
    </div>
  );
}

/**
 * Arrival Celebration Screen
 */
export function ArrivalPanel({ destinationName, onDismiss }) {
  return (
    <div
      data-testid="arrival-panel"
      className="w-full bg-white dark:bg-[#1E1E1E] text-zinc-900 dark:text-white rounded-3xl p-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)] border border-black/5 dark:border-white/10 pointer-events-auto text-center flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-200"
    >
      <div className="w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner">
        <CheckCircle2 size={32} />
      </div>
      <div>
        <h3 className="text-xl font-extrabold tracking-tight">You Have Arrived!</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          You reached <span className="font-semibold text-zinc-800 dark:text-zinc-200">{destinationName || 'your destination'}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="w-full mt-2 py-3 rounded-xl bg-[#0F9D58] hover:bg-[#0B8043] text-white font-bold text-xs tracking-tight active:scale-95 transition-all shadow-md"
      >
        Complete Navigation
      </button>
    </div>
  );
}
