import React from 'react';

// Tunable knobs for the state machine below — kept here as named constants
// (rather than inlined) so a threshold that feels wrong on real usage is a
// one-line change instead of a re-implementation. NAVIGATING_SPEED_MPS and
// GPS_HEADING_SPEED_MPS aren't consumed inside this file — App.jsx imports
// them to compute the `isNavigating` prop and to decide GPS-course vs
// compass heading — but they live here so all four stay discoverable in one
// place instead of drifting out of sync across files.
export const NEAR_ZOOM_THRESHOLD = 18;       // zoom >= this = "near" state
export const NAVIGATING_SPEED_MPS = 0.5;     // movement alone counts as navigating above this
export const GPS_HEADING_SPEED_MPS = 1.0;    // above this, trust GPS course over compass
export const CHEVRON_GAP_PX = 4;             // chevron's near edge to dot's edge
export const NAV_POINTER_SIZE_PX = 16;       // diameter of the navigating pointer's dot (the chevron ahead of it is sized from it)

// Same fixed-design-grid approach as LocationMarker.jsx: author every shape
// against a constant GRID, then let the <svg> width/height (never zoom) do
// the only scaling. Big enough to hold the largest state (navigating+near:
// 14px dot + gap + chevron + 44px bracket frame) with a little breathing room.
const GRID = 56;
const CENTER = GRID / 2;

const DOT_SIZE = { idleFar: 16, idleNear: 18, navFar: 16, navNear: 18 };
const RING_DIAMETER = 34;
const CHEVRON_BOX = { far: 14, near: 18 };
const BRACKET_FRAME = 44; // overall square the 4 corner brackets sit at the corners of
const BRACKET_ARM = 14;   // each bracket's own L-shaped arm length

// Nested <svg> lets us drop in the exact spec'd path/viewBox verbatim, then
// position + scale it independently inside the outer GRID coordinate space.
const Chevron = ({ size, color, dotRadius }) => {
  const baseFraction = 14 / 24; // where the path's open (near) end sits in its own 24-unit viewBox
  const boxTop = -(dotRadius + CHEVRON_GAP_PX) - size * baseFraction;
  return (
    <svg x={CENTER - size / 2} y={CENTER + boxTop} width={size} height={size} viewBox="0 0 24 24">
      <path d="M7 14l5-5 5 5" style={{ stroke: color }} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
};

// The navigating pointer: a dot with one chevron just ahead of it, drawn pointing up (north).
const NAV_DOT_R = NAV_POINTER_SIZE_PX / 2;
const navChevron = `M ${CENTER - 8} ${CENTER - NAV_DOT_R - 4} L ${CENTER} ${CENTER - NAV_DOT_R - 13} L ${CENTER + 8} ${CENTER - NAV_DOT_R - 4}`;

// Screen-fixed viewfinder corners — frame position, never rotate with heading.
const CornerBrackets = ({ color }) => {
  const near = CENTER - BRACKET_FRAME / 2;
  const far = CENTER + BRACKET_FRAME / 2;
  const armNear = near + BRACKET_ARM;
  const armFar = far - BRACKET_ARM;
  const paths = [
    `M ${near},${armNear} L ${near},${near} L ${armNear},${near}`,
    `M ${armFar},${near} L ${far},${near} L ${far},${armNear}`,
    `M ${far},${armFar} L ${far},${far} L ${armFar},${far}`,
    `M ${armNear},${far} L ${near},${far} L ${near},${armFar}`,
  ];
  return paths.map((d, i) => (
    <path key={i} d={d} fill="none" style={{ stroke: color }} strokeWidth={2} strokeLinecap="square" />
  ));
};

/**
 * Own-position marker mirroring Google Maps' location dot: quiet at rest,
 * more informative once actually navigating. Four states driven by two
 * booleans — see the state matrix in the task spec. Fixed CSS-pixel size at
 * every zoom level (the <svg> width/height are constants, never derived from
 * `zoom` — only `isNear` reads it, to pick which state to render).
 *
 * `speed` is accepted for API symmetry with LocationMarker but isn't
 * consumed here — the caller has already folded it into `isNavigating`.
 */
// Redesign (Map batch, piece 5): your dot is the accent (--color-map-self) on the map's light
// casing, with a soft accent halo at rest; colours are set through style so they follow the
// theme's CSS variables.
const LiveLocationMarker = ({
  zoom,
  isNavigating = false,
  heading = 0,
  accuracy = null,
  color = 'var(--color-map-self)',
  roadName = null,
}) => {
  const isNear = zoom >= NEAR_ZOOM_THRESHOLD;

  const dotSize = isNear ? DOT_SIZE.idleNear : DOT_SIZE.idleFar;

  return (
    <div
      style={{
        width: GRID,
        height: GRID,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      <svg width={GRID} height={GRID} viewBox={`0 0 ${GRID} ${GRID}`} style={{ overflow: 'visible' }}>
        {isNavigating ? (
          <>
            {/* Your dot with a chevron ahead of it, turning with your heading. A thin map-casing
                edge keeps both readable on any map. */}
            <g
              style={{
                transform: `rotate(${heading}deg)`,
                transformOrigin: `${CENTER}px ${CENTER}px`,
                transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
              }}
            >
              <path d={navChevron} fill="none" style={{ stroke: 'var(--color-map-casing)' }} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
              <path d={navChevron} fill="none" style={{ stroke: color }} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={CENTER} cy={CENTER} r={NAV_DOT_R} style={{ fill: color, stroke: 'var(--color-map-casing)' }} strokeWidth={3} />
            </g>
          </>
        ) : (
          /* Normal idle state */
          <>
            <circle cx={CENTER} cy={CENTER} r={isNear ? RING_DIAMETER / 2 : RING_DIAMETER / 2.6} style={{ fill: 'var(--color-accent-halo)' }} />
            <g
              style={{
                transform: `rotate(${heading}deg)`,
                transformOrigin: `${CENTER}px ${CENTER}px`,
                transition: 'transform 0.25s ease',
              }}
            >
              <circle cx={CENTER} cy={CENTER} r={dotSize / 2} style={{ fill: color, stroke: 'var(--color-map-casing)' }} strokeWidth={3} />
            </g>
          </>
        )}
      </svg>

      {/* Street/walkway badge below marker when navigating (Google Maps style) */}
      {isNavigating && roadName && (
        <div
          className="absolute top-[52px] left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-fill bg-[var(--color-map-plate)] text-text text-caption shadow-[var(--shadow-1)] border border-border whitespace-nowrap pointer-events-none"
        >
          {roadName}
        </div>
      )}
    </div>
  );
};

export default LiveLocationMarker;
