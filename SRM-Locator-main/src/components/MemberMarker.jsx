import React, { useRef } from 'react';
import { initialsOf } from './ui/initials';
import { MARKERS } from '../copy/map';
import { useClearOfControls } from '../hooks/useClearOfControls';

// A group member on the map (redesign Map batch, piece 5): their initials in a 36 px disc, a
// solid accent ring while they share live and a dashed grey one while Paused, and a plate
// under it with their name and how far they are from you. While they move (or the group has
// a meeting point, as before), a small accent arrow outside the ring points the way they are
// heading, as the old dot's chevron did. Hidden members are never drawn (App.jsx filters them).
//
// Display only: the stored photo is still sent with every update, just not shown here.

const SIZE = 36;
const RING = 2;

/**
 * @param {{ name?: string|null, paused?: boolean, heading?: number, isNavigating?: boolean,
 *   distance?: string|null }} props
 */
export default function MemberMarker({ name, paused = false, heading = 0, isNavigating = false, distance = null }) {
  const shown = (typeof name === 'string' && name.trim()) || MARKERS.someone;
  const plate = paused ? MARKERS.memberPaused(shown) : MARKERS.memberPlate(shown, distance);
  // The plate slides left, out from under the map controls, when the member is near them.
  const plateRef = useRef(null);
  useClearOfControls(plateRef);
  return (
    <div
      data-testid="member-marker"
      data-paused={paused || undefined}
      className="relative font-ui pointer-events-none"
      style={{ width: SIZE, height: SIZE, transform: 'translate(-50%, -50%)' }}
    >
      {isNavigating && !paused && (
        <span
          className="absolute inset-0 transition-transform duration-200"
          style={{ transform: `rotate(${heading}deg)` }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 12 8" className="absolute left-1/2 -translate-x-1/2 w-3 h-2" style={{ top: -11 }}>
            <path d="M1 7 L6 1 L11 7" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      <span
        className={`absolute inset-0 flex items-center justify-center rounded-full text-secondary font-semibold shadow-[var(--shadow-1)] ${
          paused ? 'bg-surface text-text-secondary border-dashed border-border-control' : 'bg-accent-soft text-accent border-accent'
        }`}
        style={{ borderWidth: RING }}
        aria-hidden="true"
      >
        {initialsOf(shown)}
      </span>
      <span
        ref={plateRef}
        data-testid="member-plate"
        className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--color-map-plate)] px-2 py-0.5 text-caption text-text shadow-[var(--shadow-1)]"
        style={{ top: SIZE + 4 }}
      >
        {plate}
      </span>
    </div>
  );
}
