import React from 'react';

// Extracted out of App.jsx (was `CustomMarker`) so both the google-map-react
// primary map and the Leaflet fallback (TacticalLeafletMap.jsx) can render
// the same building pin without duplicating it.
const BuildingMarker = ({ onClick }) => (
  <div
    onClick={onClick}
    className="relative flex items-center justify-center cursor-pointer z-40 group -ml-3 -mt-3 w-6 h-6 pointer-events-auto"
  >
    {/* Outer pulsing red radar ring */}
    <div className="absolute w-6 h-6 bg-red-500/40 rounded-full animate-ping pointer-events-none" />
    {/* Inner glowing red dot with white border & red drop shadow */}
    <div className="w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white/90 shadow-[0_0_12px_rgba(239,68,68,0.9)] group-hover:scale-125 transition-transform duration-200" />
  </div>
);

export default BuildingMarker;
