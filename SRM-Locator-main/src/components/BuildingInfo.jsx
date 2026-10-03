import React from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { locateTarget } from '../utils/direction';
import { BUILDING_INFO_EMPTY_TEXT, buildingDetails } from '../utils/buildingInfo';

// The body of the building card's "Building Info" option. Only the fields a building has are
// shown; with none it says BUILDING_INFO_EMPTY_TEXT, so it is never blank. The distance and
// direction come from the same helper as the squad roster, so they read the same.

function Row({ label, children }) {
  return (
    <div>
      <p className="font-dot text-[10px] uppercase tracking-widest text-zinc-500">{label}</p>
      <div className="mt-0.5 font-inter text-sm text-zinc-300 leading-relaxed">{children}</div>
    </div>
  );
}

export default function BuildingInfo({ building, me, heading, headingLive, onTakeMeThere, onShowOnMap }) {
  const details = buildingDetails(building);
  const where = locateTarget(me, building, { heading, headingLive });

  return (
    <div data-testid="building-info" className="px-6 pb-4 flex flex-col gap-3">
      {details.description && <p className="font-inter text-sm text-zinc-300 leading-relaxed">{details.description}</p>}
      {details.departments.length > 0 && <Row label="Departments">{details.departments.join(', ')}</Row>}
      {details.floors && <Row label="Floors">{details.floors}</Row>}
      {details.facilities.length > 0 && <Row label="Facilities">{details.facilities.join(', ')}</Row>}
      {!details.hasDetails && (
        <p className="font-inter text-sm text-zinc-400 leading-relaxed">{building.name}. {BUILDING_INFO_EMPTY_TEXT}.</p>
      )}
      {where && (
        <Row label="From you">
          {where.here ? 'You are here' : `${where.shownDistance.value} ${where.shownDistance.unit} · ${where.direction}`}
        </Row>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onTakeMeThere}
          className="flex-1 py-3 bg-white text-black hover:bg-zinc-200 font-dot text-[10px] font-bold flex items-center justify-center gap-2 transition-colors uppercase tracking-widest"
        >
          <Navigation size={14} /> Take me there
        </button>
        <button
          type="button"
          onClick={onShowOnMap}
          className="flex-1 py-3 border border-white/20 hover:bg-white/10 text-white font-dot text-[10px] flex items-center justify-center gap-2 transition-colors uppercase tracking-widest"
        >
          <MapPin size={14} /> Show on map
        </button>
      </div>
    </div>
  );
}
