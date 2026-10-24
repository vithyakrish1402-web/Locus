import React, { useEffect, useRef, useState } from 'react';

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
// Fixed CSS-pixel size at every zoom level. Navigation uses a blue arrow with
// a white edge; at rest the position stays a small dot with a soft halo.
const GRID = 56;
const CENTER = GRID / 2;
const DOT_SIZE = { idleFar: 16, idleNear: 18 };
const RING_DIAMETER = 34;
const LiveLocationMarker = ({
  zoom,
  isNavigating = false,
  heading = 0,
  accuracy = null,
  color = 'var(--color-map-self)',
  roadName = null,
  map = null,
}) => {
  const [cameraHeading, setCameraHeading] = useState(0);
  useEffect(() => {
    if (!map) { setCameraHeading(0); return undefined; }
    const update = () => setCameraHeading(map.getHeading?.() || 0);
    update();
    const listener = map.addListener?.('heading_changed', update);
    return () => listener?.remove?.();
  }, [map]);
  const lastHeading = useRef(0);
  const target = (Number.isFinite(heading) ? heading : 0) - cameraHeading;
  const turn = ((target - lastHeading.current + 540) % 360 + 360) % 360 - 180;
  const displayHeading = lastHeading.current + turn;
  useEffect(() => { lastHeading.current = displayHeading; }, [displayHeading]);
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
            {/* A blue navigation arrow turns with your heading. Its white
                edge keeps both readable on any map. */}
            <g
              style={{
                transform: `rotate(${displayHeading}deg)`,
                transformOrigin: `${CENTER}px ${CENTER}px`,
                transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
              }}
            >
              <path d="M28 7 L44 43 L28 35 L12 43 Z" fill="#1A73E8" stroke="white" strokeWidth="3" strokeLinejoin="round" />
              <path d="M28 10 L28 34 L14 41 Z" fill="#5A9CFF" />
            </g>
          </>
        ) : (
          /* Normal idle state */
          <>
            <circle cx={CENTER} cy={CENTER} r={isNear ? RING_DIAMETER / 2 : RING_DIAMETER / 2.6} style={{ fill: 'var(--color-accent-halo)' }} />
            <g
              style={{
                transform: `rotate(${displayHeading}deg)`,
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
