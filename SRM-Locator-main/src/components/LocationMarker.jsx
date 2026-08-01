import React from 'react';

// All shapes below are authored against a fixed 80x80 design grid, then the
// <svg>'s width/height/viewBox combination scales that grid uniformly to
// `size` — so every radius/stroke stays proportional to the outer bracket
// square regardless of what `size` is.
const GRID = 80;
const CENTER = GRID / 2; // 40

// Corner brackets: 14x14 "L" arms, inset 6px from the outer edge.
const BRACKET_INSET = 6;
const BRACKET_ARM = BRACKET_INSET + 14; // 20
const BRACKET_FAR = GRID - BRACKET_INSET; // 74

const CORE_RADIUS = 15; // 30px diameter
const CORE_DOT_RADIUS = 2; // 4px diameter

// Chevron pair lives strictly between the core circle's edge (r=15) and the
// nearest point of the corner brackets (r~=39.4, the arm endpoints) — these
// bands leave a clear ~4-unit gap on every side at every rotation angle.
const CHEVRON_INNER = { base: 19, apex: 25, halfWidth: 6 };
const CHEVRON_OUTER = { base: 29, apex: 36, halfWidth: 8 };

const chevronPoints = ({ base, apex, halfWidth }) => {
  const baseY = CENTER - base;
  const apexY = CENTER - apex;
  return `${CENTER - halfWidth},${baseY} ${CENTER},${apexY} ${CENTER + halfWidth},${baseY}`;
};

/**
 * Heading-aware, state-aware tactical marker for squad members on the map.
 * Fixed pixel size regardless of map zoom — meant to be dropped straight into
 * a google-map-react (or Leaflet) marker slot, which position it via lat/lng.
 *
 * `speed` is accepted (upstream callers derive `status` from it) but isn't
 * consumed here — `status` alone drives every visual state.
 */
const LocationMarker = ({ heading = 0, status = 'stationary', size = 80, color = '#EF4444' }) => {
  const isMoving = status === 'moving';
  const isLost = status === 'signal-lost';

  const bracketRotation = isMoving ? 45 : 0;
  const chevronOpacity = isLost ? 0 : isMoving ? 1 : 0.45;
  const coreOpacity = isLost ? 0.35 : 1;

  return (
    <div
      style={{
        width: size,
        height: size,
        // No `position: absolute` here on purpose: the map libraries (google-map-react
        // and Leaflet) already absolutely-position whatever marker element they're
        // handed at the lat/lng pixel — this just needs to occupy that normal-flow
        // box (so a wrapping click-target div sizes correctly around it) and shift
        // itself to center on the anchor point via transform alone.
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} style={{ overflow: 'visible' }}>
        {/* Layer 3: split double-chevron heading indicator */}
        <g
          style={{
            opacity: chevronOpacity,
            transform: `rotate(${heading}deg)`,
            transformOrigin: `${CENTER}px ${CENTER}px`,
            transition: 'transform 0.3s ease',
          }}
        >
          <polyline
            points={chevronPoints(CHEVRON_OUTER)}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={chevronPoints(CHEVRON_INNER)}
            fill="none"
            stroke={color}
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.7}
          />
        </g>

        {/* Layer 1: outer bracket square (four L-shaped corners) */}
        <g
          style={{
            transform: `rotate(${bracketRotation}deg)`,
            transformOrigin: `${CENTER}px ${CENTER}px`,
            transition: 'transform 0.3s ease',
            animation: isLost ? 'locus-marker-bracket-pulse 1.4s ease-out infinite' : 'none',
          }}
        >
          {[
            `M ${BRACKET_INSET},${BRACKET_ARM} L ${BRACKET_INSET},${BRACKET_INSET} L ${BRACKET_ARM},${BRACKET_INSET}`,
            `M ${GRID - BRACKET_ARM},${BRACKET_INSET} L ${BRACKET_FAR},${BRACKET_INSET} L ${BRACKET_FAR},${BRACKET_ARM}`,
            `M ${BRACKET_FAR},${GRID - BRACKET_ARM} L ${BRACKET_FAR},${BRACKET_FAR} L ${GRID - BRACKET_ARM},${BRACKET_FAR}`,
            `M ${BRACKET_ARM},${BRACKET_FAR} L ${BRACKET_INSET},${BRACKET_FAR} L ${BRACKET_INSET},${GRID - BRACKET_ARM}`,
          ].map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="square"
              strokeDasharray={isLost ? '3 2' : 'none'}
            />
          ))}
        </g>

        {/* Layer 2: core circle + center lock dot */}
        <g style={{ opacity: coreOpacity }}>
          <circle cx={CENTER} cy={CENTER} r={CORE_RADIUS} fill="#000000" stroke={color} strokeWidth={1} />
          <circle cx={CENTER} cy={CENTER} r={CORE_DOT_RADIUS} fill={color} />
        </g>

        {isLost && (
          <text
            x={CENTER}
            y={CENTER + CORE_RADIUS + 9}
            textAnchor="middle"
            fontFamily="'Space Mono', monospace"
            fontSize={9}
            fill={color}
          >
            LKL
          </text>
        )}
      </svg>
    </div>
  );
};

export default LocationMarker;
