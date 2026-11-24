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
  const walk = where && !where.here ? walkLabel(where.distance) : null;

  return (
    <div
      data-testid="building-row"
      className="building-card group text-text font-ui"
    >
      {/* Horizontal Layout: 68px Thumbnail + Main Content + Chevron */}
      <button type="button" onClick={onOpen} aria-label={`View ${building.name}`} className="building-card-main flex items-center gap-3 text-left w-full">
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
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent-soft text-accent">
              {asset?.categoryDisplay || categoryLabel(building.category)}
            </span>
          </div>

          {/* Prominent Building Name */}
          <h4 className="text-[15px] font-semibold text-text leading-snug line-clamp-2 group-hover:text-accent transition-colors">
            {building.name}
          </h4>

          {/* Distance and Walking Time on One Muted Secondary Line */}
          {away && (
            <p className="text-[11px] text-text-secondary font-normal flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1">
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
      </button>

      {/* Compact Inline Actions */}
      <div className="building-card-actions flex items-center justify-end gap-2">
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
          className="!min-h-[44px] !h-[44px] !px-3 !rounded-full !text-[12px] !font-medium shrink-0"
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
          className="!min-h-[44px] !h-[44px] !px-4 !rounded-full !text-[12px] !font-medium shrink-0"
        >
          {BUILDING_LIST.navigate}
        </Button>
      </div>
    </div>
  );
}
