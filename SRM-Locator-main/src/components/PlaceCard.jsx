import React, { useState } from 'react';
import {
  Building2,
  Camera,
  ChevronLeft,
  ChevronRight,
  Flag,
  Navigation,
  ScanLine,
  X,
} from 'lucide-react';
import { PLACE, categoryLabel } from '../copy/place';
import { getBuildingAsset } from '../data/srmBuildingAssets';
import CampusBuildingImage from './map/CampusBuildingImage';

// The action row at the bottom of the card. The old "More Info" button was 44 px tall inside
// this same footer; the three buttons are taller (about 56 px, never under 48) so an icon and
// a short label stack comfortably. The radius is the old button's (rounded-xl).
export const ACTION_BUTTON_HEIGHT = 56;
export const ACTION_BUTTON_GAP = 10;
export const ACTION_BUTTON_RADIUS = 12;

// Flat and quiet, in the app's own accent (theme tokens, so it follows light and dark): one
// solid colour for the primary action, hairline outlines for the others, no glow.
const PRIMARY_LOOK = 'bg-accent hover:brightness-110 active:brightness-95 text-accent-on border border-accent';
const SECONDARY_LOOK = 'bg-sunken hover:bg-accent-soft active:bg-accent-soft text-text border border-border';
const ACTIVE_LOOK = 'bg-accent-soft hover:brightness-110 text-accent border border-accent';

// eslint-disable-next-line no-unused-vars -- Icon is used as <Icon />, which this config can't see
function ActionButton({ icon: Icon, label, look, ...props }) {
  return (
    <button
      type="button"
      style={{ height: ACTION_BUTTON_HEIGHT, borderRadius: ACTION_BUTTON_RADIUS }}
      className={`min-w-0 px-1 flex flex-col items-center justify-center gap-1.5 font-medium transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${look}`}
      {...props}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span className="max-w-full truncate whitespace-nowrap text-xs leading-4">{label}</span>
    </button>
  );
}

/**
 * Clickable Building Marker HUD Card.
 * The building image(s), tags and name, and three actions for the building: Navigate, Rally
 * (the group's meeting point) and AR Scan.
 *
 * @param {{
 *   place: object,
 *   onClose: () => void,
 *   onNavigate: () => void,
 *   onArScan: () => void,
 *   rally: { active: boolean, onPress: () => void },
 * }} props
 *   rally.active: the group's rally point is already this place; pressing it offers to clear it
 */
export default function PlaceCard({
  place,
  onClose,
  onNavigate,
  onArScan,
  rally,
}) {
  const asset = getBuildingAsset(place);
  const category = asset?.categoryDisplay || categoryLabel(place?.category);
  const photos = asset?.photos?.length > 0 ? asset.photos : asset?.image ? [asset.image] : ['/buildings/campus_main.jpg'];
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  const handlePrevPhoto = (e) => {
    e.stopPropagation();
    setActivePhotoIdx((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
  };

  const handleNextPhoto = (e) => {
    e.stopPropagation();
    setActivePhotoIdx((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
  };

  return (
    <div className="relative rounded-2xl bg-surface border border-border shadow-lg text-text font-ui flex flex-col overflow-hidden w-full max-w-sm">
      {/* Top Hero Photo Gallery */}
      <div className="relative w-full h-44 sm:h-48 bg-black/50 shrink-0 overflow-hidden">
        <CampusBuildingImage
          key={photos[activePhotoIdx] || asset?.image}
          src={photos[activePhotoIdx] || asset?.image}
          alt={place?.name || 'Building'}
          aspectRatio="aspect-auto"
          containerClassName="w-full h-full"
        />

        {/* Cinematic gradient overlay blending photo into card */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />

        {/* Top Floating Controls */}
        <div className="absolute inset-x-0 top-0 p-3 flex items-center justify-between pointer-events-none">
          {/* Photo Counter Pill (when multiple photos) */}
          {photos.length > 1 ? (
            <div className="px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white/90 text-[11px] font-semibold tracking-wider flex items-center gap-1.5 shadow-sm pointer-events-auto">
              <Camera size={12} className="text-blue-400" />
              <span>{activePhotoIdx + 1}/{photos.length}</span>
            </div>
          ) : <div />}

          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-xl bg-black/60 hover:bg-black/85 backdrop-blur-md border border-white/15 text-white/90 hover:text-white flex items-center justify-center transition-all active:scale-95 shadow-md pointer-events-auto"
          >
            <X size={16} />
          </button>
        </div>

        {/* Photo Navigation Arrows (when multiple photos) */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrevPhoto}
              aria-label="Previous photo"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 hover:bg-black/85 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-all active:scale-95 shadow-md"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={handleNextPhoto}
              aria-label="Next photo"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 hover:bg-black/85 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-all active:scale-95 shadow-md"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      {/* Card Content: Title & Tags */}
      <div className="p-4 flex flex-col gap-2.5">
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-text leading-tight break-words">
          {place?.name}
        </h2>

        {/* Tags Section */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {category && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold tracking-wide bg-accent-soft text-accent">
              <Building2 size={12} className="shrink-0" />
              <span>{category}</span>
            </span>
          )}
          {/* Its tags. The Open/Closed and floor-count chips are gone: nothing had checked them. */}
          {asset?.tags?.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-normal bg-sunken text-text-secondary border border-border"
            >
              {tag}
            </span>
          ))}
        </div>
        {asset?.description && (
          <p className="text-text-secondary" style={{ fontSize: 13, lineHeight: '1.25rem' }} data-testid="place-description">
            {asset.description}
          </p>
        )}
      </div>

      {/* Bottom actions: Navigate (primary), Rally and AR Scan. Outside the photo, so the
          photo arrows and the close button are never in their way. */}
      <div className="p-3 bg-surface border-t border-border shrink-0">
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: ACTION_BUTTON_GAP }}
        >
          <ActionButton
            icon={Navigation}
            label={PLACE.navigate}
            look={PRIMARY_LOOK}
            onClick={onNavigate}
            data-testid="place-navigate"
          />
          <ActionButton
            icon={Flag}
            label={rally.active ? PLACE.rallySet : PLACE.rally}
            look={rally.active ? ACTIVE_LOOK : SECONDARY_LOOK}
            onClick={rally.onPress}
            aria-pressed={rally.active}
            aria-label={rally.active ? PLACE.rallyClearLabel : PLACE.rallyLabel}
            data-testid="place-rally"
          />
          <ActionButton
            icon={ScanLine}
            label={PLACE.arScan}
            look={SECONDARY_LOOK}
            onClick={onArScan}
            data-testid="place-ar-scan"
          />
        </div>
      </div>
    </div>
  );
}
