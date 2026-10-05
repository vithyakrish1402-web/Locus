import React from 'react';
import { Navigation, X } from 'lucide-react';
import { ROUTE_CARD } from '../../copy/map';

// Your own route (Navigate), as a card under the sharing chip (redesign Map batch, piece 6):
// "Walking to Tech Park", how long and how far, and from where. "End route" ends your route
// only; it never clears the group's meeting point (owner, 2026-10-05).
//
// Without a GPS fix Navigate is two steps: the first place is the start, and until the
// destination is chosen the card says so.

// "450 M" / "1.20 KM" / "6 MINS" (from the route helpers) in the card's words.
const quiet = (text) => String(text ?? '').toLowerCase().replace(/\bmins?\b/, 'min').trim();

/**
 * @param {{ start: {name: string}|null, end: {name: string}|null,
 *   data: {distance: {text: string}, duration: {text: string}}|null, onEnd: () => void }} props
 */
export default function RouteCard({ start, end, data, onEnd }) {
  const fromYou = start?.name === 'MY_LOCATION';
  const title = end ? ROUTE_CARD.walkingTo(end.name) : ROUTE_CARD.choosing;
  const where = fromYou ? ROUTE_CARD.fromYou : start ? ROUTE_CARD.from(start.name) : '';
  const detail = end
    ? [data && quiet(data.duration.text), data && quiet(data.distance.text), where].filter(Boolean).join(' · ')
    : ROUTE_CARD.choosingHelp(start?.name);

  return (
    <div
      data-testid="route-card"
      className="flex items-center gap-3 rounded-card bg-raised text-text font-ui shadow-[var(--shadow-2)] border border-border py-3 pl-3 pr-1 pointer-events-auto"
    >
      <span className="flex items-center justify-center w-10 h-10 rounded-full bg-accent-soft text-accent shrink-0" aria-hidden="true">
        <Navigation size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-heading break-words">{title}</p>
        {detail && <p className="text-secondary text-text-secondary break-words">{detail}</p>}
      </div>
      <button
        type="button"
        onClick={onEnd}
        aria-label={ROUTE_CARD.end}
        title={ROUTE_CARD.end}
        className="shrink-0 inline-flex items-center gap-1 min-h-[var(--size-touch)] px-3 rounded-full text-label text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {ROUTE_CARD.end}
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
