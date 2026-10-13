import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Bookmark,
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
  const [isBookmarked, setIsBookmarked] = useState(false);

  // Approximate walk time in minutes
  const walkMinutes = where && !where.here ? Math.max(1, Math.round(where.distance / 75)) : 2;

  return (
    <div className="relative rounded-3xl glass-floating text-text font-ui flex flex-col overflow-hidden max-h-[85vh]">
      {/* Top Hero Photo Gallery */}
      <div className="relative w-full h-48 sm:h-56 bg-sunken shrink-0">
        <CampusBuildingImage
          src={photos[activePhotoIdx] || asset?.image}
          alt={place.name}
          aspectRatio="aspect-auto"
          containerClassName="w-full h-full"
        />

        {/* Floating Controls Over Hero Banner */}
        <div className="absolute inset-x-0 top-0 p-3 flex items-center justify-between bg-gradient-to-b from-black/50 via-black/20 to-transparent pointer-events-none">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="w-9 h-9 rounded-full glass-pill text-text flex items-center justify-center shadow-md hover:scale-105 pointer-events-auto transition-transform active:scale-95"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="flex items-center gap-2 pointer-events-auto">
            <button
              type="button"
              onClick={() => setIsBookmarked(!isBookmarked)}
              aria-label="Bookmark"
              className={`w-9 h-9 rounded-full glass-pill flex items-center justify-center shadow-md transition-[transform,opacity] active:scale-95 ${
                isBookmarked
                  ? '!bg-accent !text-accent-on !border-accent'
                  : 'text-text hover:scale-105'
              }`}
            >
              <Bookmark size={18} className={isBookmarked ? 'fill-current' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={PLACE.close}
              className="w-9 h-9 rounded-full glass-pill text-text flex items-center justify-center shadow-md hover:scale-105 active:scale-95"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Photo Index Indicator */}
        {photos.length > 1 && (
          <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-[11px] font-medium flex items-center gap-1.5 shadow-sm">
            <Camera size={12} className="opacity-90" />
            <span>{activePhotoIdx + 1}/{photos.length}</span>
          </div>
        )}
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 custom-scrollbar">
        {/* Title & Category Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {category && <Chip tone="neutral">{category}</Chip>}
              {asset?.categoryDisplay && asset.categoryDisplay !== category && (
                <span className="text-[11px] font-semibold text-accent bg-accent-soft px-2.5 py-1 rounded-full border border-accent/20">
                  {asset.categoryDisplay}
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-text break-words leading-snug">
              {place.name}
            </h2>
            {asset?.floors && (
              <p className="text-xs font-semibold text-text-secondary mt-1 tracking-normal">
                {asset.floors} Floors
              </p>
            )}
          </div>
        </div>

        {/* Quick Stat Chips (Apple Maps inspiration) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-1">
          {/* Distance & Walk Time */}
          {where && (
            <div
              data-testid="place-distance"
              className="flex items-center gap-2.5 p-2.5 rounded-2xl glass-panel text-left"
            >
              <span className="w-8 h-8 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                <MapPin size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-text leading-tight">
                  {!where.here ? distanceLabel(where.shownDistance) : 'Here'}
                </p>
                <p className="text-[11px] font-medium text-text-secondary truncate">
                  ~{walkMinutes} min walk
                </p>
              </div>
            </div>
          )}

          {/* Operating Hours */}
          <div className="flex items-center gap-2.5 p-2.5 rounded-2xl glass-panel text-left">
            <span className="w-8 h-8 rounded-xl bg-success-soft text-success flex items-center justify-center shrink-0">
              <Clock size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-success leading-tight flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-success inline-block shrink-0 shadow-[0_0_6px_var(--color-success)]" />
                <span>Open</span>
              </p>
              <p className="text-[11px] font-medium text-text-secondary truncate">
                {asset?.hours?.replace('Open • ', '') || 'Campus Hours'}
              </p>
            </div>
          </div>

          {/* Quick AR Action */}
          <button
            type="button"
            onClick={onArScan}
            className="flex items-center gap-2.5 p-2.5 rounded-2xl glass-panel hover:bg-surface/80 text-left"
          >
            <span className="w-8 h-8 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <ScanLine size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-text leading-tight">
                AR Scan
              </p>
              <p className="text-[11px] font-medium text-text-secondary truncate">
                Camera Finder
              </p>
            </div>
          </button>
        </div>

        {/* Description */}
        <div className="text-sm text-text-secondary leading-relaxed font-normal">
          {asset?.description || place.info}
        </div>

        {/* Facilities Grid */}
        {asset?.facilities && asset.facilities.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Facilities & Amenities
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {asset.facilities.map((fac) => {
                const IconComponent = getFacilityIcon(fac);
                return (
                  <div
                    key={fac}
                    className="flex items-center gap-2 p-2 rounded-xl glass-panel text-xs font-medium text-text"
                  >
                    <IconComponent size={15} className="text-accent shrink-0" />
                    <span className="truncate">{fac}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Photos Strip */}
        {photos.length > 1 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Photos
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
              {photos.map((photoUrl, idx) => (
                <button
                  type="button"
                  key={photoUrl}
                  onClick={() => setActivePhotoIdx(idx)}
                  className={`relative w-20 h-16 rounded-xl overflow-hidden shrink-0 transition-[transform,opacity] border-2 ${
                    activePhotoIdx === idx
                      ? 'border-accent scale-105 shadow-md'
                      : 'border-transparent opacity-75 hover:opacity-100'
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

        {/* Expandable Building Info section */}
        {expanded && (
          <div className="border-t border-border pt-3">
            <BuildingInfo building={place} me={me} heading={heading} headingLive={headingLive} />
          </div>
        )}
      </div>

      {/* Sticky Bottom Actions Bar */}
      <div className="p-3.5 sm:p-4 glass-panel !border-x-0 !border-b-0 border-t border-border/60 flex flex-col gap-2 shrink-0">
        <div className="grid grid-cols-2 gap-2">
          <Button
            icon={Navigation}
            onClick={onNavigate}
            className="w-full !rounded-xl !h-11 !py-0 font-semibold !text-[13px] tracking-tight gap-1.5"
          >
            {choosingDestination ? PLACE.setDestination : PLACE.navigate}
          </Button>
          <Button
            variant="tonal"
            icon={ScanLine}
            onClick={onArScan}
            className="w-full !rounded-xl !h-11 !py-0 font-semibold !text-[13px] tracking-tight gap-1.5"
          >
            {PLACE.arScan}
          </Button>
        </div>

        {onSetMeetingPoint && (
          <Button
            variant="secondary"
            icon={Flag}
            block
            onClick={onSetMeetingPoint}
            className="!rounded-xl !h-9 !py-0 font-medium !text-[12px] text-text-secondary hover:text-text gap-1.5 border-0"
          >
            {PLACE.setMeetingPoint}
          </Button>
        )}

        <div className="flex justify-center items-center gap-3 pt-0.5">
          <Button
            variant="plain"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            className="!text-[11.5px] font-medium !min-h-6 !py-0 px-2 text-text-secondary hover:text-text"
          >
            {expanded ? PLACE.less : PLACE.more}
          </Button>
          {expanded && (
            <Button
              variant="plain"
              icon={MapPin}
              onClick={onShowOnMap}
              className="!text-[11.5px] font-medium !min-h-6 !py-0 px-2 text-text-secondary hover:text-text"
            >
              {PLACE.showOnMap}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
