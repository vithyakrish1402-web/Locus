import React, { useRef } from 'react';
import { Flag, ScanLine, X } from 'lucide-react';
import { MARKERS } from '../copy/map';
import { useClearOfControls } from '../hooks/useClearOfControls';

// Extracted out of App.jsx so both the google-map-react primary map and the
// Leaflet fallback (TacticalLeafletMap.jsx) can render the same meeting point
// marker without duplicating it.
//
// Redesign (Map batch, piece 5): an ink pin with a flag (--color-map-meeting), a plate
// "Meeting point · {place}", and its two small round buttons: Find with AR Scan, for every
// member, and Remove, only for who may remove it (the Group Lead, or whoever set it).
const WaypointMarker = ({ name, onClick, onClear, canClear, onTrack }) => {
  // The plate slides left, out from under the map controls, when the pin is near them.
  const plateRef = useRef(null);
  useClearOfControls(plateRef);
  return (
    <div
      onClick={onClick}
      data-testid="meeting-point-marker"
      className="w-12 h-12 -ml-6 -mt-6 flex items-center justify-center cursor-pointer relative z-[60] font-ui select-none pointer-events-auto"
    >
      {/* Gentle idle breathing halo for the Rally Point, strictly anchored at coordinate center */}
      <div className="absolute -inset-1 rounded-full bg-accent-halo locus-soft-ring pointer-events-none" aria-hidden="true" />
      <div className="absolute inset-1.5 rounded-full bg-[var(--color-map-meeting)] text-bg border-[3px] border-[var(--color-map-casing)] shadow-[var(--shadow-2)] flex items-center justify-center transition-transform duration-200 active:scale-95">
        <Flag size={18} aria-hidden="true" />
      </div>
      <div ref={plateRef} data-testid="meeting-point-plate" className="absolute top-full mt-1 whitespace-nowrap rounded-full bg-[var(--color-map-plate)] px-2.5 py-0.5 text-caption font-semibold text-text shadow-[var(--shadow-1)] pointer-events-none transition-opacity duration-200">
        {MARKERS.meetingPointPlate(name)}
      </div>
      {/* Find with AR Scan: every member (not just whoever set it) gets a bearing to it. */}
      {onTrack && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTrack(); }}
          title={MARKERS.findWithAr}
          aria-label={MARKERS.findWithAr}
          className="absolute -bottom-1 -right-2 w-7 h-7 rounded-full bg-raised text-accent border border-border shadow-[var(--shadow-1)] flex items-center justify-center z-[61]"
        >
          <ScanLine size={14} aria-hidden="true" />
        </button>
      )}
      {canClear && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          title={MARKERS.removeMeetingPoint}
          aria-label={MARKERS.removeMeetingPoint}
          className="absolute -top-1 -right-2 w-7 h-7 rounded-full bg-raised text-text-secondary border border-border shadow-[var(--shadow-1)] flex items-center justify-center z-[61]"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default WaypointMarker;
