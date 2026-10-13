import React from 'react';
import { Flag, Loader2, MapPinOff, X } from 'lucide-react';
import { Button } from '../ui';
import { MAP_BANNERS } from '../../copy/map';

// The map's banners (redesign Map batch, piece 7). They sit in the stack under the top bar,
// in place of the sharing chip while they show, and let taps through to the map and the
// group panel except on their own buttons (they used to cover the Group Lead's buttons).

/** "Tap the map to place a meeting point", with Cancel. */
export function MeetingPointBanner({ onCancel }) {
  return (
    <div
      data-testid="meeting-point-banner"
      role="status"
      className="flex items-center gap-3 rounded-card glass-panel text-text border border-accent font-ui py-2 pl-3 pr-1 shadow-md"
    >
      <Flag size={22} className="text-accent shrink-0" aria-hidden="true" />
      <p className="flex-1 min-w-0 text-label">{MAP_BANNERS.placeMeetingPoint}</p>
      <Button variant="plain" onClick={onCancel} className="pointer-events-auto shrink-0">{MAP_BANNERS.cancel}</Button>
    </div>
  );
}

/**
 * The location problem, in amber: location turned off (or refused), or no fix yet. It stays
 * until a real fix clears it or it is dismissed, as before.
 * @param {{ kind: 'denied'|'no-fix', onDismiss: () => void, onTurnOn?: (() => void) | null }} props
 *   onTurnOn: asks for location again (the location-off state only)
 */
export function LocationProblemCard({ kind, onDismiss, onTurnOn = null }) {
  const words = kind === 'denied' ? MAP_BANNERS.locationOff : MAP_BANNERS.noFix;
  return (
    <div
      data-testid="location-problem"
      data-kind={kind}
      role="alert"
      className="rounded-card glass-panel text-text font-ui p-3 flex flex-col gap-3 shadow-md"
    >
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-10 h-10 rounded-full bg-warning-soft text-warning shrink-0" aria-hidden="true">
          <MapPinOff size={20} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-heading">{words.title}</p>
          <p className="text-secondary text-text-secondary">{words.body}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          title={MAP_BANNERS.dismiss}
          aria-label={MAP_BANNERS.dismiss}
          className="shrink-0 -mt-1 -mr-1 inline-flex items-center justify-center w-11 h-11 rounded-full text-text-secondary hover:text-text pointer-events-auto"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {onTurnOn && (
        <Button variant="tonal" block onClick={onTurnOn} className="pointer-events-auto">{MAP_BANNERS.turnOn}</Button>
      )}
    </div>
  );
}

/** "Finding your location…" while the first fix is on its way. */
export function FindingLocation() {
  return (
    <div className="absolute inset-x-0 top-1/2 z-[800] flex justify-center pointer-events-none">
      <p
        data-testid="finding-location"
        role="status"
        className="inline-flex items-center gap-3 rounded-full glass-pill text-text font-ui text-label px-5 min-h-14 shadow-md"
      >
        <Loader2 size={20} className="text-accent animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {MAP_BANNERS.finding}
      </p>
    </div>
  );
}
