import React, { useId } from 'react';
import { ROAD_LINE_NEAR_OPACITY, ROAD_LINE_FAR_OPACITY } from '../utils/arRoadLine';

// AR Scan's road line: the ribbon from buildRoadRibbon, filled in the app's tactical red
// and fading out with distance (solid at your feet, faint at the draw limit). Drawn in
// screen pixels over the camera, taking no touches.
const ARRoadLine = ({ ribbon, width, height }) => {
  const fadeId = `ar-road-fade-${useId().replace(/:/g, '')}`;
  const outline = [...ribbon.left, ...[...ribbon.right].reverse()]
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  // A vertical fade from where the ribbon starts to where it ends on screen. When they
  // are (nearly) level, a gradient along no length is undefined, so fill it flat.
  const flat = Math.abs(ribbon.nearY - ribbon.farY) < 1;
  return (
    <svg
      data-testid="ar-road-line"
      className="absolute inset-0 pointer-events-none z-[15]"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {!flat && (
        <defs>
          <linearGradient id={fadeId} gradientUnits="userSpaceOnUse" x1="0" y1={ribbon.nearY} x2="0" y2={ribbon.farY}>
            <stop offset="0" stopColor="#EF4444" stopOpacity={ROAD_LINE_NEAR_OPACITY} />
            <stop offset="1" stopColor="#EF4444" stopOpacity={ROAD_LINE_FAR_OPACITY} />
          </linearGradient>
        </defs>
      )}
      <polygon points={outline} fill={flat ? '#EF4444' : `url(#${fadeId})`} fillOpacity={flat ? 0.35 : 1} />
    </svg>
  );
};

export default ARRoadLine;
