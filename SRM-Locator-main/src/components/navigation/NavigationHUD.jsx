import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { PANEL_SPRING } from '../../utils/motion';
import { NAV_BUILD } from '../../utils/navBuild';
import { ROUTE_FAILURE } from '../../hooks/useNavigationController';
import {
  MapPin,
  CheckCircle2,
  X,
  AlertTriangle,
  RefreshCw,
  LocateFixed,
} from 'lucide-react';

// What went wrong, in words, with what the button does about it (useNavigationController's
// ROUTE_FAILURE). Every failure used to read "Off route", even the first route of a trip.
const FAILURE_WORDS = {
  [ROUTE_FAILURE.noMappedPath]: { title: 'No mapped path from here', action: 'Try again' },
  [ROUTE_FAILURE.noRoute]: { title: 'No walking route found', action: 'Try again' },
  [ROUTE_FAILURE.unavailable]: { title: "Can't reach the route service", action: 'Try again' },
};
const OFF_ROUTE_WORDS = { title: 'Off route', action: 'Tap to recalculate route' };

// Navigation overlay settings.
export const NAV_PANEL_MAX_HEIGHT_PCT = 15; // the bar's cap, as a share of the screen height
export const NAV_PANEL_TEXT_LINES = 1; // the instruction runs to this many lines, then an ellipsis
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

// One line, then an ellipsis. The line count is a constant so it is one place to change.
const clampLines = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: NAV_PANEL_TEXT_LINES,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
};

// Puts the action first on a narrow bar: "Head northwest toward Temple tree PG for girls
// hostel" becomes "Head northwest" when it is long. Short instructions are left alone.
const SHORTEN_ABOVE = 30;
export function shortenInstruction(text) {
  if (!text || text.length <= SHORTEN_ABOVE) return text;
  const cut = text.search(/\s+(toward|towards)\s/i);
  return cut > 0 ? text.slice(0, cut) : text;
}

/**
 * The one navigation panel, a slim bar at the top of the map: turn arrow, distance to the turn,
 * a one-line instruction and the close button; under it a small THEN line, and one thin summary
 * line (minutes · distance · arrival time · destination). The close button ends navigation.
 * Colours, font and corners come from the theme tokens (src/theme/tokens.css), so it follows
 * light/dark and any future accent change. Auto-centre and Re-center live in the map's
 * right-hand toolbar (components/map/MapControls.jsx), not here.
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
  const instruction = shortenInstruction(
    currentStep?.instruction || `Head to ${destinationName || 'destination'}`,
  );

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
      data-nav-build={NAV_BUILD}
      className="w-full overflow-hidden rounded-card border border-border bg-surface text-text shadow-[var(--shadow-2)] font-ui pointer-events-auto"
      style={{ maxHeight: `${NAV_PANEL_MAX_HEIGHT_PCT}vh` }}
    >
      <div className="flex items-center gap-2.5 pl-2.5 pr-1 pt-1.5">
        {isRerouting ? (
          <RefreshCw size={22} className="shrink-0 animate-spin text-accent" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-fill bg-accent-soft text-accent">
            <ManeuverIcon maneuver={currentStep?.maneuver || 'straight'} size={22} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          {isRerouting ? (
            <p className="text-label animate-pulse">Recalculating…</p>
          ) : rerouteError ? (
            <>
              <p data-testid="nav-failure" className="text-label flex items-center gap-1.5 text-warning">
                <AlertTriangle size={16} /> {(FAILURE_WORDS[rerouteError] ?? OFF_ROUTE_WORDS).title}
              </p>
              <button type="button" onClick={onRetryReroute} className="text-caption text-accent underline">
                {(FAILURE_WORDS[rerouteError] ?? OFF_ROUTE_WORDS).action}
              </button>
            </>
          ) : !currentStep ? (
            <>
              <p className="text-label flex animate-pulse items-center gap-1.5">
                <LocateFixed size={16} className="text-accent" /> Acquiring GPS…
              </p>
              <p className="text-caption text-text-secondary" style={clampLines}>
                Navigating to {destinationName || 'destination'}
              </p>
            </>
          ) : (
            <>
              <p data-testid="nav-distance" className="text-[1.0625rem] font-bold leading-tight tabular-nums">
                {distText}
              </p>
              <p data-testid="nav-instruction" className="text-secondary leading-tight text-text-secondary" style={clampLines}>
                {instruction}
              </p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onEnd}
          aria-label="End route"
          title="Exit navigation"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-fill text-text-secondary transition-transform active:scale-95 hover:text-text"
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      </div>

      {/* The step after this one: just the turn and how far */}
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
            <div className="flex items-center gap-1.5 px-3 pb-1 text-caption text-text-secondary">
              <span className="uppercase tracking-wider">Then</span>
              <ManeuverIcon maneuver={nextStep.maneuver || 'straight'} size={14} className="shrink-0 text-accent" />
              {nextStep.distanceMeters > 0 && (
                <span className="tabular-nums">{fmtDistance(nextStep.distanceMeters)}</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trip summary: one thin line */}
      <div
        data-testid="navigation-summary"
        className="flex items-center gap-1.5 border-t border-border px-3 py-1 text-caption tabular-nums"
      >
        {summaryLoading ? (
          <span className="animate-pulse text-text-secondary">Calculating walking time…</span>
        ) : (
          <>
            <span className="shrink-0 font-semibold text-accent">{remainingMinutes} min</span>
            <span aria-hidden="true" className="text-text-secondary">·</span>
            <span className="shrink-0">{fmtDistance(remainingMeters, 2)}</span>
            {NAV_SHOW_ARRIVAL_TIME && (
              <>
                <span aria-hidden="true" className="text-text-secondary">·</span>
                <span className="shrink-0">{arrivalTime}</span>
              </>
            )}
          </>
        )}
        <span aria-hidden="true" className="text-text-secondary">·</span>
        <MapPin size={12} className="shrink-0 text-accent" />
        <span className="min-w-0 truncate font-semibold">{destinationName || 'Destination'}</span>
      </div>
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
