import React from 'react';
import { GHOST_OPACITY } from './utils/ghostProjection';

// Fixed CSS-pixel grid, same convention as LiveLocationMarker.jsx — never
// scales with zoom.
const GRID = 40;
const CENTER = GRID / 2;
const RING_RADIUS = 12;
const RING_STROKE = 2;

/**
 * A squad member who's gone signal-lost: solid fill swapped for a dashed
 * outline ring at GHOST_OPACITY, with a live-updating "how long dark" tag.
 * The dead-reckoning projection *line* is drawn separately at the map layer
 * (it spans two geo-coordinates, not something a marker-local icon can
 * express) — this component only owns the point itself.
 *
 * `phase` ('projecting' | 'frozen' | 'expired') only changes the tag's
 * wording here — the position/line decay logic lives in ghostProjection.js,
 * driven by whichever lat/lng the caller positions this marker at.
 */
const GhostMemberMarker = ({ phase = 'projecting', elapsedLabel = '0:00', color = '#A1A1AA' }) => {
  const label = phase === 'expired' ? 'LAST KNOWN' : 'SIGNAL LOST';

  return (
    <div
      style={{
        position: 'relative',
        width: GRID,
        height: GRID,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      <svg width={GRID} height={GRID} viewBox={`0 0 ${GRID} ${GRID}`} style={{ overflow: 'visible', opacity: GHOST_OPACITY }}>
        <circle cx={CENTER} cy={CENTER} r={RING_RADIUS} fill="none" stroke={color} strokeWidth={RING_STROKE} strokeDasharray="4 3" />
      </svg>

      <div
        className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-dot text-[9px] uppercase tracking-widest px-1.5 py-0.5"
        style={{
          top: GRID,
          marginTop: 4,
          color,
          border: `1px dashed ${color}`,
          background: 'rgba(0,0,0,0.75)',
        }}
      >
        {label} · {elapsedLabel} AGO
      </div>
    </div>
  );
};

export default GhostMemberMarker;
