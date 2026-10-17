import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Building2,
  Car,
  Clock,
  Coffee,
  Flag,
  MapPin,
  Monitor,
  MoreHorizontal,
  Navigation,
  ScanLine,
  ShieldCheck,
  Snowflake,
  VolumeX,
  Wifi,
  X,
  BookOpen,
  Camera
} from 'lucide-react';
import { Button, Chip, IconButton } from './ui';
import BuildingInfo from './BuildingInfo';
import { locateTarget } from '../utils/direction';
import { PLACE, categoryLabel, directionLabel, distanceLabel, walkLabel } from '../copy/place';
import { getBuildingAsset } from '../data/srmBuildingAssets';
import CampusBuildingImage from './map/CampusBuildingImage';

/**
 * Facility icon mapping for senior Google/Apple Maps aesthetic.
 */
function getFacilityIcon(facility) {
  const f = facility.toLowerCase();
  if (f.includes('wi-fi') || f.includes('wifi') || f.includes('internet')) return Wifi;
  if (f.includes('ac') || f.includes('air conditioning')) return Snowflake;
  if (f.includes('study') || f.includes('reading') || f.includes('library')) return BookOpen;
  if (f.includes('computer') || f.includes('lab') || f.includes('pc') || f.includes('terminal')) return Monitor;
  if (f.includes('quiet') || f.includes('silent')) return VolumeX;
  if (f.includes('security') || f.includes('safe')) return ShieldCheck;
  if (f.includes('cafeteria') || f.includes('dining') || f.includes('mess') || f.includes('coffee') || f.includes('food')) return Coffee;
  if (f.includes('parking') || f.includes('valet')) return Car;
  return Building2;
}

/**
 * Apple/Google Maps style Glassmorphic Place Detail Card.
 * Matches the inspiration design with full-bleed photo hero, facilities chips,
 * photo gallery, walk metrics, and sticky navigation bar.
 *
 * `onBack` (optional) makes the back arrow collapse to the cloud instead of closing.
 * `onHeaderPointerDown` (optional) gets the photo header's pointer-down, to start a sheet drag.
 * The card fills the height its container gives it: the body scrolls; header and actions stay.
 * @param {{ place: object, me: {lat:number,lng:number}|null, heading?: number,
 *   headingLive?: boolean, choosingDestination?: boolean, expanded: boolean,
 *   onToggleExpanded: () => void, onClose: () => void, onNavigate: () => void,
 *   onArScan: () => void, onSetMeetingPoint?: (() => void) | null, onShowOnMap: () => void }} props
 */
export default function PlaceCard({
  place,
  me,
  heading,
  headingLive,
  choosingDestination = false,
  expanded,
  onToggleExpanded,
  onClose,
  onBack = null,
  onHeaderPointerDown,
  onNavigate,
  onArScan,
  onSetMeetingPoint = null,
  onShowOnMap,
}) {
  const where = locateTarget(me, place, { heading, headingLive });
  const category = categoryLabel(place.category);
  const direction = directionLabel(where);
  const summary = where && !where.here
    ? [direction, walkLabel(where.distance)].filter(Boolean).join(' · ')
    : direction;

  const asset = getBuildingAsset(place);
  const photos = asset?.photos || [asset?.image];
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  // Approximate walk time in minutes
  const walkMinutes = where && !where.here ? Math.max(1, Math.round(where.distance / 75)) : 2;

  // One scroll area (the body) and one drag area (the photo header): the card fills the
  // height its sheet gives it, so there is never a scroller inside a scroller.
  const stopDrag = (e) => e.stopPropagation(); // a button on the header must not start a drag
  return (
    <div className="relative flex flex-col h-full min-h-0 bg-surface text-text font-ui">
      {/* Header: the photo, the grab handle and the controls. Dragging it down collapses. */}
      <div
        className="relative w-full h-40 shrink-0 bg-sunken overflow-hidden cursor-grab"
        style={{ touchAction: 'none' }}
        onPointerDown={onHeaderPointerDown}
      >
        <div className="absolute inset-0 locus-hero-settle">
          <CampusBuildingImage
            src={photos[activePhotoIdx] || asset?.image}
            alt={place.name}
            aspectRatio="aspect-auto"
            containerClassName="w-full h-full"
          />
        </div>
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-surface/70 to-transparent pointer-events-none" />
        <span aria-hidden="true" className="absolute top-2 left-1/2 -translate-x-1/2 block w-10 h-1 rounded-full bg-white/80 pointer-events-none" />

        <div className="absolute inset-x-0 top-3 px-3 flex items-center justify-between pointer-events-none">
          <button
            type="button"
            onClick={onBack || onClose}
            onPointerDown={stopDrag}
            aria-label="Back"
            className="w-11 h-11 rounded-full bg-surface/90 text-text flex items-center justify-center shadow-md pointer-events-auto active:scale-95"
          >
            <ArrowLeft size={19} />
          </button>
          <button
            type="button"
            onClick={onClose}
            onPointerDown={stopDrag}
            aria-label={PLACE.close}
            className="w-11 h-11 rounded-full bg-surface/90 text-text flex items-center justify-center shadow-md pointer-events-auto active:scale-95"
          >
            <X size={19} />
          </button>
        </div>

        {photos.length > 1 && (
          <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/60 text-white text-[11px] font-medium flex items-center gap-1.5 pointer-events-none">
            <Camera size={12} className="opacity-90" />
            <span>{activePhotoIdx + 1}/{photos.length}</span>
          </div>
        )}
      </div>

      {/* Body: the only scroller. Its children arrive one after another (index.css). */}
      <div className="locus-cloud-reveal flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-4 pb-5 flex flex-col gap-5 custom-scrollbar">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {category && <Chip tone="neutral">{category}</Chip>}
            {asset?.categoryDisplay && asset.categoryDisplay !== category && (
              <span className="text-[11px] font-semibold text-accent bg-accent-soft px-2.5 py-1 rounded-full">
                {asset.categoryDisplay}
              </span>
            )}
          </div>
          <h2 className="text-[22px] font-bold tracking-tight text-text break-words leading-tight">
            {place.name}
          </h2>
          {asset?.floors && (
            <p className="text-[13px] font-medium text-text-secondary mt-1">
              {asset.floors} floors
            </p>
          )}
        </div>

        {/* Three equal tiles: how far, whether it is open, and the camera finder. */}
        <div className="grid grid-cols-3 gap-2.5">
          {where && (
            <div
              data-testid="place-distance"
              className="flex flex-col items-start gap-2 p-3 rounded-2xl bg-sunken text-left min-w-0"
            >
              <span className="w-8 h-8 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
                <MapPin size={16} />
              </span>
              <div className="min-w-0 w-full">
                <p className="text-[13px] font-bold text-text leading-tight truncate">
                  {!where.here ? distanceLabel(where.shownDistance) : 'Here'}
                </p>
                <p className="text-[11px] font-medium text-text-secondary truncate">
                  ~{walkMinutes} min walk
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col items-start gap-2 p-3 rounded-2xl bg-sunken text-left min-w-0">
            <span className="w-8 h-8 rounded-xl bg-success-soft text-success flex items-center justify-center">
              <Clock size={16} />
            </span>
            <div className="min-w-0 w-full">
              <p className="text-[13px] font-bold text-success leading-tight flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block shrink-0" />
                <span>Open</span>
              </p>
              <p className="text-[11px] font-medium text-text-secondary truncate">
                {asset?.hours?.replace('Open • ', '') || 'Campus Hours'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onArScan}
            className="flex flex-col items-start gap-2 p-3 rounded-2xl bg-sunken text-left min-w-0 active:scale-[0.97]"
          >
            <span className="w-8 h-8 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
              <ScanLine size={16} />
            </span>
            <div className="min-w-0 w-full">
              <p className="text-[13px] font-bold text-text leading-tight truncate">
                AR Scan
              </p>
              <p className="text-[11px] font-medium text-text-secondary truncate">
                Camera Finder
              </p>
            </div>
          </button>
        </div>

        <p className="text-[15px] text-text-secondary leading-relaxed">
          {asset?.description || place.info}
        </p>

        {asset?.facilities && asset.facilities.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Facilities &amp; Amenities
            </h3>
            <div className="flex flex-wrap gap-2">
              {asset.facilities.map((fac) => {
                const IconComponent = getFacilityIcon(fac);
                return (
                  <span
                    key={fac}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sunken text-[12px] font-medium text-text"
                  >
                    <IconComponent size={14} className="text-accent shrink-0" />
                    {fac}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {photos.length > 1 && (
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Photos
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
              {photos.map((photoUrl, idx) => (
                <button
                  type="button"
                  key={photoUrl}
                  onClick={() => setActivePhotoIdx(idx)}
                  aria-label={`Photo ${idx + 1} of ${photos.length}`}
                  className={`relative w-24 h-[72px] rounded-xl overflow-hidden shrink-0 border-2 ${
                    activePhotoIdx === idx ? 'border-accent' : 'border-transparent opacity-70'
                  }`}
                >
                  <CampusBuildingImage
                    src={photoUrl}
                    alt={`${place.name} ${idx + 1}`}
                    aspectRatio="aspect-auto"
                    containerClassName="w-full h-full"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {expanded && (
          <div className="border-t border-border pt-4">
            <BuildingInfo building={place} me={me} heading={heading} headingLive={headingLive} />
          </div>
        )}
      </div>

      {/* Actions stay in view while the body scrolls. */}
      <div className="px-4 pt-3 pb-1 bg-surface border-t border-border flex flex-col gap-0.5 shrink-0">
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            icon={Navigation}
            onClick={onNavigate}
            className="w-full !rounded-xl !h-12 !py-0 font-semibold !text-[14px] tracking-tight gap-1.5"
          >
            {choosingDestination ? PLACE.setDestination : PLACE.navigate}
          </Button>
          <Button
            variant="tonal"
            icon={ScanLine}
            onClick={onArScan}
            className="w-full !rounded-xl !h-12 !py-0 font-semibold !text-[14px] tracking-tight gap-1.5"
          >
            {PLACE.arScan}
          </Button>
        </div>

        {/* The less-used actions share one quiet row, so the body keeps the room. */}
        <div className="flex items-center justify-center gap-1">
          {onSetMeetingPoint && (
            <Button
              variant="plain"
              icon={Flag}
              onClick={onSetMeetingPoint}
              className="!text-[12.5px] font-medium !min-h-11 !py-0 px-3 text-text-secondary hover:text-text gap-1.5"
            >
              {PLACE.setMeetingPoint}
            </Button>
          )}
          <Button
            variant="plain"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            className="!text-[12.5px] font-medium !min-h-11 !py-0 px-3 text-text-secondary hover:text-text"
          >
            {expanded ? PLACE.less : PLACE.more}
          </Button>
          {expanded && (
            <Button
              variant="plain"
              icon={MapPin}
              onClick={onShowOnMap}
              className="!text-[12.5px] font-medium !min-h-11 !py-0 px-3 text-text-secondary hover:text-text"
            >
              {PLACE.showOnMap}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
