import React, { useState, useEffect, useMemo } from 'react';
import {
  MapPin,
  CheckCircle2,
  X,
  AlertTriangle,
  RefreshCw,
  LocateFixed,
  Crosshair,
} from 'lucide-react';

/**
 * Authentic Google Maps directional navigation arrows
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
          <circle cx="16" cy="14" r="4" fill="#0B8043" />
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

/**
 * Authentic Google Maps Green Navigation Header
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
}) {
  const distText =
    distanceToNextMeters > 1000
      ? `${(distanceToNextMeters / 1000).toFixed(1)} km`
      : `${Math.round(distanceToNextMeters || 0)} m`;

  // Parse street/walkway title cleanly
  const rawInstruction = currentStep?.instruction || `Head to ${destinationName || 'destination'}`;
  let primaryTitle = rawInstruction;
  let secondaryDetail = '';

  if (rawInstruction.includes('onto ')) {
    const parts = rawInstruction.split('onto ');
    secondaryDetail = parts[0].trim();
    primaryTitle = parts[1].trim();
  } else if (rawInstruction.includes('towards ')) {
    const parts = rawInstruction.split('towards ');
    secondaryDetail = parts[0].trim();
    primaryTitle = parts[1].trim();
  } else if (rawInstruction.toLowerCase().startsWith('turn ')) {
    primaryTitle = rawInstruction;
  }

  return (
    <div
      data-testid="turn-instruction-card"
      className="w-full rounded-3xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.35)] text-white font-ui border border-emerald-400/20 pointer-events-auto transition-all duration-300"
    >
      {/* Primary Green Navigation Bar */}
      <div className="bg-[#0F9D58] px-4 py-3.5 flex items-start gap-4">
        {/* Left Side: Large Maneuver Arrow & Distance */}
        <div className="flex flex-col items-center justify-center shrink-0 min-w-[64px]">
          {isRerouting ? (
            <RefreshCw size={36} className="animate-spin text-white my-1" />
          ) : (
            <div className="w-12 h-12 flex items-center justify-center text-white">
              <ManeuverIcon maneuver={currentStep?.maneuver || 'straight'} size={38} />
            </div>
          )}
          <span className="text-xl md:text-2xl font-black text-white tracking-tight mt-0.5">
            {distText}
          </span>
        </div>

        {/* Center / Right: Large Street Name & Next Action */}
        <div className="min-w-0 flex-1 pt-0.5">
          {isRerouting ? (
            <div>
              <p className="text-xl font-bold text-white animate-pulse">Recalculating…</p>
              <p className="text-xs text-emerald-100 font-medium mt-0.5">Finding optimal pedestrian path</p>
            </div>
          ) : rerouteError ? (
            <div>
              <p className="text-lg font-bold text-yellow-200 flex items-center gap-1.5">
                <AlertTriangle size={18} /> Off route
              </p>
              <button
                type="button"
                onClick={onRetryReroute}
                className="text-xs text-white underline font-medium hover:opacity-90 mt-1"
              >
                Tap to recalculate route
              </button>
            </div>
          ) : !currentStep ? (
            <div>
              <p className="text-lg font-bold text-white animate-pulse flex items-center gap-2">
                <LocateFixed size={18} /> Acquiring GPS…
              </p>
              <p className="text-xs text-emerald-100 truncate mt-0.5">
                Navigating to {destinationName || 'destination'}
              </p>
            </div>
          ) : (
            <div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-snug truncate">
                {primaryTitle}
              </h2>
              {secondaryDetail && (
                <p className="text-xs md:text-sm font-semibold text-emerald-100/90 mt-0.5 truncate">
                  {secondaryDetail}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Top-Right: Exit Button */}
        <button
          type="button"
          onClick={onEnd}
          aria-label="End route"
          title="Exit navigation"
          className="w-9 h-9 rounded-full bg-black/20 hover:bg-black/35 text-white/90 hover:text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform"
        >
          <X size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* Secondary "Then" Row (Directly attached underneath, exactly like Google Maps) */}
      {nextStep && !isRerouting && (
        <div className="bg-[#0B8043] px-4 py-2 flex items-center gap-2.5 text-white/95 text-xs font-semibold border-t border-black/10">
          <span className="bg-black/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white">
            Then
          </span>
          <ManeuverIcon maneuver={nextStep.maneuver || 'straight'} size={18} className="text-white shrink-0" />
          <span className="truncate text-xs font-medium text-emerald-50">
            {nextStep.instruction || destinationName}
          </span>
          {nextStep.distanceMeters > 0 && (
            <span className="ml-auto text-[11px] text-emerald-100 font-semibold shrink-0">
              {nextStep.distanceMeters > 1000
                ? `${(nextStep.distanceMeters / 1000).toFixed(1)} km`
                : `${Math.round(nextStep.distanceMeters)} m`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Authentic Google Maps Bottom Trip Summary Card
 */
export function NavigationSummaryCard({
  remainingMeters,
  remainingMinutes,
  destinationName,
  onEnd,
}) {
  const isLoading = !remainingMeters && !remainingMinutes;
  const distText =
    remainingMeters > 1000
      ? `${(remainingMeters / 1000).toFixed(2)} km`
      : `${Math.round(remainingMeters || 0)} m`;

  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const timeString = useMemo(() => {
    const etaArrival = new Date(currentTime + Math.max(1, remainingMinutes || 1) * 60000);
    return etaArrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [currentTime, remainingMinutes]);

  return (
    <div
      data-testid="navigation-summary-card"
      className="w-full bg-white dark:bg-[#1E1E1E] text-zinc-900 dark:text-white rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.3)] border border-black/5 dark:border-white/10 p-4 font-ui pointer-events-auto transition-all"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left Side: Walking ETA, Arrival Time, Distance */}
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <div className="flex items-baseline gap-2">
              <span className="text-base font-bold text-[#1E8E3E] dark:text-[#34D399] animate-pulse">
                Calculating walking ETA…
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-[#1E8E3E] dark:text-[#34D399] tracking-tight">
                {remainingMinutes} <span className="text-base font-bold text-zinc-500 dark:text-zinc-400">min</span>
              </span>
              <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                · {distText}
              </span>
              <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                · {timeString}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 font-medium truncate mt-1">
            <MapPin size={13} className="text-red-500 shrink-0" />
            <span className="truncate">Walking to <strong className="font-semibold text-zinc-900 dark:text-white">{destinationName || 'Destination'}</strong></span>
          </div>
        </div>

        {/* Right Side: Circular Exit Cross Button */}
        <button
          type="button"
          onClick={onEnd}
          aria-label="End route"
          title="Exit navigation"
          className="w-11 h-11 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 active:scale-95 transition-all shadow-sm"
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

/**
 * Google Maps Floating Action Re-center Button
 */
export function RecenterButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="nav-recenter-button"
      aria-label="Re-center navigation"
      className="absolute bottom-28 right-4 z-40 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white dark:bg-[#202124] text-zinc-800 dark:text-white shadow-[0_6px_25px_rgba(0,0,0,0.25)] border border-black/5 dark:border-white/10 text-xs font-bold pointer-events-auto active:scale-95 transition-all"
    >
      <Crosshair size={18} className="text-blue-600 dark:text-blue-400 animate-pulse" />
      <span>Re-center</span>
    </button>
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
