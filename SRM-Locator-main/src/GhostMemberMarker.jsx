import React, { useRef } from 'react';
import { GHOST_OPACITY } from './utils/ghostProjection';
import { initialsOf } from './components/ui/initials';
import { MARKERS } from './copy/map';
import { useClearOfControls } from './hooks/useClearOfControls';
import FocusRing from './components/map/FocusRing';

const SIZE = 36;

/**
 * A group member whose connection was lost: their initials in a dashed grey ring at
 * GHOST_OPACITY (the handoff's "last known" look), with a live-updating "how long" plate.
 * The dead-reckoning projection *line* is drawn separately at the map layer
 * (it spans two geo-coordinates, not something a marker-local icon can
 * express) — this component only owns the point itself.
 *
 * `phase` ('projecting' | 'frozen' | 'expired') only changes the plate's
 * wording here — the position/line decay logic lives in ghostProjection.js,
 * driven by whichever lat/lng the caller positions this marker at.
 */
const GhostMemberMarker = ({ name, phase = 'projecting', elapsedLabel = '0:00', highlighted = false }) => {
  const shown = (typeof name === 'string' && name.trim()) || MARKERS.someone;
  const plate = phase === 'expired' ? MARKERS.lastSeen(shown, elapsedLabel) : MARKERS.lostConnection(shown, elapsedLabel);
  // The plate slides left, out from under the map controls, when the marker is near them.
  const plateRef = useRef(null);
  useClearOfControls(plateRef);

  return (
    <div
      data-testid="ghost-marker"
      data-phase={phase}
      data-highlighted={highlighted || undefined}
      className="relative font-ui cursor-pointer select-none"
      style={{ width: SIZE, height: SIZE, transform: `translate(-50%, -50%)${highlighted ? ' scale(1.25)' : ''}`, pointerEvents: 'auto' }}
    >
      {highlighted && <FocusRing />}
      <span
        className="absolute inset-0 flex items-center justify-center rounded-full bg-surface text-secondary font-semibold text-[var(--color-map-last-known)] border-2 border-dashed border-[var(--color-map-last-known)]"
        style={{ opacity: GHOST_OPACITY }}
        aria-hidden="true"
      >
        {initialsOf(shown)}
      </span>
      <span
        ref={plateRef}
        data-testid="ghost-plate"
        className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--color-map-plate)] px-2 py-0.5 text-caption text-text-secondary shadow-[var(--shadow-1)]"
        style={{ top: SIZE + 4 }}
      >
        {plate}
      </span>
    </div>
  );
};

export default GhostMemberMarker;
