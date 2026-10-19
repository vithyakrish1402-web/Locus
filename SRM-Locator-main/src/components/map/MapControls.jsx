import React, { useRef } from 'react';
// eslint-disable-next-line no-unused-vars -- motion is used as <motion.span>, which this config can't see
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Flag, Layers, LocateFixed, MapPin, Navigation, Settings, X } from 'lucide-react';
import { MAP_CONTROLS } from '../../copy/map';

// The map's right-hand controls (redesign Map batch, piece 2): one raised column of round
// buttons. The design shows two (map/satellite and locate); every control the app has stays:
// show the whole campus, show where you are (once there is a fix), Map / Satellite, and the
// gear for Settings (owner's decision).
//
// And the meeting point button at the bottom right on a phone: tap, then tap the map to place
// the group's meeting point; tap again (X) to cancel.

const ROUND = 'relative inline-flex items-center justify-center w-11 h-11 rounded-full transition-all duration-150 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * @param {{ onCampus: () => void, onLocate?: (() => void) | null, isSatellite: boolean,
 *   onToggleSatellite: () => void, onSettings: () => void, onToggleAutoFollow?: (() => void) | null,
 *   autoFollow?: boolean }} props
 *   onLocate: null until there is a fix to show (while navigating it is Re-center)
 *   onToggleAutoFollow: only while navigating; keeps the camera on you (Auto), lit when on
 */
/**
 * The gear opens Settings the moment the finger lands (pointerdown), not when it lifts and a
 * click arrives. That same tap still sends a click afterwards, which must not toggle again;
 * a click with no pointerdown before it (a keyboard or a screen reader) opens it as usual.
 */
function useOpenOnTouchDown(onOpen) {
  const handledRef = useRef(false);
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      handledRef.current = true;
      onOpen();
    },
    onClick: () => {
      if (handledRef.current) { handledRef.current = false; return; }
      onOpen();
    },
  };
}

export function MapControls({ onCampus, onLocate = null, isSatellite, onToggleSatellite, onSettings, onToggleAutoFollow = null, autoFollow = false }) {
  const gear = useOpenOnTouchDown(onSettings);
  return (
    <div
      data-testid="map-controls"
      className="absolute right-3 top-1/3 z-40 flex flex-col items-center rounded-full glass-floating text-text p-1 gap-1 pointer-events-auto"
    >
      <button type="button" className={`${ROUND} ${isSatellite ? 'bg-accent-soft text-accent' : ''}`} onClick={onToggleSatellite} aria-pressed={isSatellite} aria-label={MAP_CONTROLS.satellite} title={MAP_CONTROLS.satellite}>
        <Layers size={21} aria-hidden="true" />
      </button>
      {onLocate && (
        <button type="button" className={`${ROUND} text-accent`} onClick={onLocate} aria-label={MAP_CONTROLS.locate} title={MAP_CONTROLS.locate}>
          {/* One soft ring breathes out now and then, like a beacon. */}
          <span className="absolute inset-1 rounded-full border border-accent locus-soft-ring" aria-hidden="true" />
          <LocateFixed size={21} aria-hidden="true" />
        </button>
      )}
      {onToggleAutoFollow && (
        <button type="button" data-testid="auto-follow-button" className={`${ROUND} ${autoFollow ? 'bg-accent-soft text-accent' : 'text-text-secondary'}`} onClick={onToggleAutoFollow} aria-pressed={autoFollow} aria-label={autoFollow ? MAP_CONTROLS.autoOn : MAP_CONTROLS.autoOff} title={autoFollow ? MAP_CONTROLS.autoOn : MAP_CONTROLS.autoOff}>
          <Navigation size={21} aria-hidden="true" />
        </button>
      )}
      <button type="button" className={ROUND} onClick={onCampus} aria-label={MAP_CONTROLS.campus} title={MAP_CONTROLS.campus}>
        <MapPin size={21} aria-hidden="true" />
      </button>
      <span className="w-6 h-px bg-[var(--glass-border-subtle)]" aria-hidden="true" />
      <button type="button" className={ROUND} {...gear} aria-label={MAP_CONTROLS.settings} title={MAP_CONTROLS.settings}>
        <Settings size={21} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The meeting point button (a phone's bottom right, above the tab bar).
 * @param {{ choosing: boolean, onToggle: () => void }} props
 */
export function MeetingPointButton({ choosing, onToggle }) {
  const reduceMotion = useReducedMotion();
  const label = choosing ? MAP_CONTROLS.cancelMeetingPoint : MAP_CONTROLS.placeMeetingPoint;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={choosing}
      aria-label={label}
      title={label}
      data-testid="meeting-point-button"
      className={`md:hidden fixed bottom-24 right-4 z-[1050] inline-flex items-center justify-center w-14 h-14 rounded-full pointer-events-auto shadow-[var(--shadow-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${choosing ? 'bg-raised text-accent border-2 border-accent' : 'bg-accent text-accent-on'
        }`}
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Choosing: a dashed ring slowly turns round the button while a spot is chosen. */}
      {choosing && <span className="absolute -inset-2 rounded-full border-2 border-dashed border-accent locus-orbit" aria-hidden="true" />}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={choosing ? 'cancel' : 'place'}
          className="flex"
          initial={reduceMotion ? { opacity: 0 } : { rotate: -90, scale: 0.6, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { rotate: 90, scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {choosing ? <X size={24} aria-hidden="true" /> : <Flag size={24} aria-hidden="true" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
