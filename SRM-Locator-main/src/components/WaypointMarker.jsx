import React from 'react';
import { Crosshair, X } from 'lucide-react';

// Extracted out of App.jsx so both the google-map-react primary map and the
// Leaflet fallback (TacticalLeafletMap.jsx) can render the same rally-point
// marker without duplicating it.
const WaypointMarker = ({ name, onClick, onClear, canClear }) => (
  <div
    onClick={onClick}
    className="w-12 h-12 -ml-6 -mt-6 rounded-full flex items-center justify-center cursor-pointer relative z-[60]"
  >
    <div className="absolute inset-0 rounded-full border-2 border-red-500 bg-red-500/20 animate-ping" />
    <div className="absolute inset-2 rounded-full border-2 border-red-500 bg-black/80 shadow-[0_0_20px_rgba(239,68,68,0.8)] flex items-center justify-center">
      <Crosshair size={18} className="text-red-500" />
    </div>
    <div className="absolute top-full mt-1 whitespace-nowrap bg-red-500 text-white font-dot text-[10px] uppercase px-2 py-0.5 tracking-widest pointer-events-none">
      {name}
    </div>
    {canClear && (
      <button
        onClick={(e) => { e.stopPropagation(); onClear(); }}
        title="Clear Rally Point"
        className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-black border-2 border-white/60 flex items-center justify-center text-white hover:bg-red-500 hover:border-red-500 transition-colors z-[61] shadow-[0_0_8px_rgba(0,0,0,0.6)]"
      >
        <X size={12} />
      </button>
    )}
  </div>
);

export default WaypointMarker;
