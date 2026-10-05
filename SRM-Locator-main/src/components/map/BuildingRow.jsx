import React from 'react';
import { Navigation, ScanLine } from 'lucide-react';
import { Button, Chip } from '../ui';
import { locateTarget } from '../../utils/direction';
import { categoryLabel, distanceLabel } from '../../copy/place';
import { BUILDING_LIST } from '../../copy/map';

// One building in the buildings list, the group panel's other tab (redesign Map batch, piece
// 9): its category, name, how far it is, one line about it, and AR Scan and Navigate (your
// own route, as on the place card). Tapping the row shows the building on the map.

/**
 * @param {{ building: object, me: {lat:number,lng:number}|null, onOpen: () => void,
 *   onArScan: () => void, onNavigate: () => void }} props
 */
export default function BuildingRow({ building, me, onOpen, onArScan, onNavigate }) {
  const where = locateTarget(me, building);
  const away = where && !where.here ? BUILDING_LIST.away(distanceLabel(where.shownDistance)) : where?.here ? BUILDING_LIST.here : null;
  return (
    <div
      data-testid="building-row"
      onClick={onOpen}
      className="rounded-card bg-surface text-text font-ui shadow-[var(--shadow-1)] border border-border p-4 flex flex-col gap-3 cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 flex flex-col items-start gap-1.5">
          <Chip tone="neutral">{categoryLabel(building.category)}</Chip>
          <h4 className="text-heading break-words">{building.name}</h4>
          {away && <p className="text-secondary text-text-secondary">{away}</p>}
        </div>
      </div>
      {building.info && <p className="text-body text-text-secondary">{building.info}</p>}
      <div className="flex gap-2">
        <Button
          variant="tonal"
          icon={ScanLine}
          aria-label={BUILDING_LIST.arScanFor(building.name)}
          title={BUILDING_LIST.arScanFor(building.name)}
          onClick={(e) => { e.stopPropagation(); onArScan(); }}
          className="shrink-0"
        >
          {BUILDING_LIST.arScan}
        </Button>
        <Button
          icon={Navigation}
          block
          aria-label={BUILDING_LIST.navigateTo(building.name)}
          onClick={(e) => { e.stopPropagation(); onNavigate(); }}
        >
          {BUILDING_LIST.navigate}
        </Button>
      </div>
    </div>
  );
}
