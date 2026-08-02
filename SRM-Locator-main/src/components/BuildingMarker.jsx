import React from 'react';

// Extracted out of App.jsx (was `CustomMarker`) so both the google-map-react
// primary map and the Leaflet fallback (TacticalLeafletMap.jsx) can render
// the same building pin without duplicating it. Every building renders as this
// dot now — not a traced footprint outline, which read as "wrong" even when
// accurate: overhead satellite imagery here is captured off-nadir, so a roof
// is visually displaced from the ground footprint OSM traces, and a polygon
// exposes that displacement in a way a single point never can.
const BuildingMarker = ({ onClick, highlighted = false }) => (
  <div
    onClick={onClick}
    className="relative flex items-center justify-center cursor-pointer z-40 group -ml-3 -mt-3 w-6 h-6 pointer-events-auto"
  >
    {/* Outer pulsing radar ring */}
    <div className={`absolute w-6 h-6 rounded-full animate-ping pointer-events-none ${highlighted ? 'bg-white/50' : 'bg-red-500/40'}`} />
    {/* Inner glowing dot — white when this is the selected/waypointed building, matching
        the white-on-red highlight convention used elsewhere (e.g. the old footprint
        highlight style), red otherwise. */}
    <div
      className={`rounded-full border-2 shadow-[0_0_12px_rgba(239,68,68,0.9)] group-hover:scale-125 transition-transform duration-200 ${
        highlighted ? 'w-4 h-4 bg-white border-red-500' : 'w-3.5 h-3.5 bg-red-500 border-white/90'
      }`}
    />
  </div>
);

export default BuildingMarker;
