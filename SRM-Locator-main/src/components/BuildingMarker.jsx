import React from 'react';

// Extracted out of App.jsx (was `CustomMarker`) so both the google-map-react
// primary map and the Leaflet fallback (TacticalLeafletMap.jsx) can render
// the same building pin without duplicating it. Every building renders as this
// dot now — not a traced footprint outline, which read as "wrong" even when
// accurate: overhead satellite imagery here is captured off-nadir, so a roof
// is visually displaced from the ground footprint OSM traces, and a polygon
// exposes that displacement in a way a single point never can.
//
// Redesign (Map batch, piece 5): a quiet 12 px slate dot on a light casing, and the chosen
// building (selected, or your destination) a larger accent dot with a soft halo. No pulse.
const BuildingMarker = ({ onClick, highlighted = false }) => (
  <div
    onClick={onClick}
    data-testid="building-marker"
    data-highlighted={highlighted || undefined}
    className="relative flex items-center justify-center cursor-pointer z-40 group -ml-3 -mt-3 w-6 h-6 pointer-events-auto select-none"
  >
    {highlighted && (
      <div
        className="absolute w-8 h-8 rounded-full bg-accent-halo locus-soft-ring pointer-events-none"
        aria-hidden="true"
      />
    )}
    <div
      className={`rounded-full border-[3px] border-[var(--color-map-casing)] shadow-[var(--shadow-1)] group-hover:scale-125 transition-[transform,opacity] duration-200 ease-out ${
        highlighted ? 'w-[18px] h-[18px] bg-accent scale-110 shadow-[0_0_12px_var(--color-accent-halo)]' : 'w-3.5 h-3.5 bg-[var(--color-map-building)]'
      }`}
    />
  </div>
);

export default BuildingMarker;
