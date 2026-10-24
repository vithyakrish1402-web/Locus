import React from 'react';
import { ChevronRight, Navigation, ScanLine } from 'lucide-react';
import { Button } from '../ui';
import { locateTarget } from '../../utils/direction';
import { categoryLabel, distanceLabel, walkLabel } from '../../copy/place';
import { BUILDING_LIST } from '../../copy/map';
import { getBuildingAsset } from '../../data/srmBuildingAssets';
import CampusBuildingImage from './CampusBuildingImage';

/**
 * Clean, minimalist Android campus-navigation card for SRM KTR.
 * Designed with a compact horizontal layout, 68px square thumbnail,
 * prominent typography, understated category pill, combined distance/walk line,
 * and compact inline action controls.
 *
 * @param {{ building: object, me: {lat:number,lng:number}|null, onOpen: () => void,
 *   onArScan: () => void, onNavigate: () => void }} props
 */
export default function BuildingRow({ building, me, onOpen, onArScan, onNavigate }) {
  const where = locateTarget(me, building);
  const away = where && !where.here
    ? BUILDING_LIST.away(distanceLabel(where.shownDistance))
    : where?.here
    ? BUILDING_LIST.here
    : null;

  const asset = getBuildingAsset(building);
  const dist = where && !where.here ? distanceLabel(where.shownDistance) : null;
  const walk = where && !where.here ? walkLabel(where.distance) : null;

  return (
    <div
      data-testid="building-row"
      onClick={onOpen}
      className="group relative rounded-2xl glass-panel hover:bg-surface/90 hover:scale-[1.01] transition-all duration-200 p-3 sm:p-3.5 flex flex-col gap-2.5 cursor-pointer text-text font-ui shadow-sm"
    >
      {/* Horizontal Layout: 68px Thumbnail + Main Content + Chevron */}
      <div className="flex items-center gap-3">
        {/* Consistent 68px Square Thumbnail */}
        <div className="relative w-[68px] h-[68px] rounded-xl overflow-hidden shrink-0 bg-sunken border border-[var(--glass-border-subtle)]">
          <CampusBuildingImage
            src={asset?.image}
            alt={building.name}
            aspectRatio="aspect-square"
            containerClassName="w-full h-full"
          />
        </div>

        {/* Info Column */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {/* Category Pill */}
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-sunken text-text-secondary border border-[var(--glass-border-subtle)]">
              {asset?.categoryDisplay || categoryLabel(building.category)}
            </span>
          </div>

          {/* Prominent Building Name */}
          <h4 className="text-[15px] font-semibold text-text leading-tight truncate group-hover:text-accent transition-colors">
            {building.name}
          </h4>

          {/* Distance and Walking Time on One Muted Secondary Line */}
          {away && (
            <p className="text-[12px] text-text-secondary font-normal flex items-center gap-1.5 mt-0.5 truncate">
              <span>{away}</span>
              {walk && (
                <>
                  <span className="text-text-secondary/50" aria-hidden="true">•</span>
                  <span>{walk}</span>
                </>
              )}
            </p>
          )}

          {/* Single Truncated Info Line */}
          {(asset?.description || building.info) && (
            <p className="text-[12px] text-text-secondary truncate mt-0.5 leading-normal">
              {asset?.description || building.info}
            </p>
          )}
        </div>

        {/* Subtle Chevron indicator */}
        <div className="shrink-0 text-text-secondary group-hover:text-accent transition-colors self-center p-0.5">
          <ChevronRight size={18} className="stroke-[2]" />
        </div>
      </div>

      {/* Compact Inline Actions */}
      <div className="flex items-center justify-end gap-2 pt-1.5 border-t border-[var(--glass-border-subtle)]">
        {/* Secondary AR Scan Button */}
        <Button
          variant="tonal"
          icon={ScanLine}
          aria-label={BUILDING_LIST.arScanFor(building.name)}
          title={BUILDING_LIST.arScanFor(building.name)}
          onClick={(e) => {
            e.stopPropagation();
            onArScan();
          }}
          className="!min-h-[34px] !h-[34px] !px-3 !rounded-full !text-[12px] !font-medium shrink-0"
        >
          {BUILDING_LIST.arScan}
        </Button>

        {/* Primary Navigate Button */}
        <Button
          icon={Navigation}
          aria-label={BUILDING_LIST.navigateTo(building.name)}
          onClick={(e) => {
            e.stopPropagation();
            onNavigate();
          }}
          className="!min-h-[34px] !h-[34px] !px-4 !rounded-full !text-[12px] !font-medium shrink-0"
        >
          {BUILDING_LIST.navigate}
        </Button>
      </div>
    </div>
  );
}
