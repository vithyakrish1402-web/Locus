import React from 'react';
import { ArrowUp, Flag, MapPin, Navigation, ScanLine, X } from 'lucide-react';
import { Button, Chip, IconButton } from './ui';
import BuildingInfo from './BuildingInfo';
import { locateTarget } from '../utils/direction';
import { PLACE, categoryLabel, directionLabel, distanceLabel, walkLabel } from '../copy/place';

// The card for a place picked on the map or in the buildings list (redesign P5c): its
// category, name and one line about it, how far it is, and what you can do there.
//
//   Navigate             your own route only: nobody else is told (see App.jsx,
//                        handleWaypointSelect). Without a GPS fix it is two steps, and the
//                        second place's button reads "Set as destination".
//   AR Scan              opens AR Scan on the place
//   Set as meeting point quieter, under the two: asks first, then sets the group's meeting
//                        point as before (publish-waypoint). Only offered in a group.
//   More about this place  opens the details in place; "Show less" closes them, and "Show
//                        on map" (kept from the old Building Info panel) glides the map there.

/**
 * @param {{ place: object, me: {lat:number,lng:number}|null, heading?: number,
 *   headingLive?: boolean, choosingDestination?: boolean, expanded: boolean,
 *   onToggleExpanded: () => void, onClose: () => void, onNavigate: () => void,
 *   onArScan: () => void, onSetMeetingPoint?: (() => void) | null, onShowOnMap: () => void }} props
 */
export default function PlaceCard({
  place, me, heading, headingLive, choosingDestination = false, expanded, onToggleExpanded,
  onClose, onNavigate, onArScan, onSetMeetingPoint = null, onShowOnMap,
}) {
  const where = locateTarget(me, place, { heading, headingLive });
  const category = categoryLabel(place.category);
  const direction = directionLabel(where);
  const summary = where && !where.here
    ? [direction, walkLabel(where.distance)].filter(Boolean).join(' · ')
    : direction;

  return (
    <div className="rounded-card bg-raised text-text font-ui shadow-[var(--shadow-2)] border border-border p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 flex flex-col items-start gap-2">
          {category && <Chip tone="neutral">{category}</Chip>}
          <h2 className="text-title break-words">{place.name}</h2>
        </div>
        <IconButton label={PLACE.close} icon={X} onClick={onClose} className="-mr-2 -mt-1 shrink-0" />
      </div>

      {place.info && <p className="text-body text-text-secondary">{place.info}</p>}

      {where && (
        <div className="flex items-center gap-3" data-testid="place-distance">
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-accent-soft text-accent shrink-0" aria-hidden="true">
            {where.clock && !where.here
              ? <ArrowUp size={18} style={{ transform: `rotate(${where.clock.hour * 30}deg)` }} />
              : <MapPin size={18} />}
          </span>
          <p className="text-body text-text-secondary min-w-0">
            {!where.here && <span className="text-heading text-text">{distanceLabel(where.shownDistance)}</span>}
            {!where.here && summary && ' · '}
            {summary}
          </p>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border pt-3">
          <BuildingInfo building={place} me={me} heading={heading} headingLive={headingLive} />
        </div>
      )}

      <div className="flex gap-3">
        <Button icon={Navigation} block onClick={onNavigate} className="flex-1">
          {choosingDestination ? PLACE.setDestination : PLACE.navigate}
        </Button>
        <Button variant="tonal" icon={ScanLine} block onClick={onArScan} className="flex-1">{PLACE.arScan}</Button>
      </div>
      {onSetMeetingPoint && (
        <Button variant="secondary" icon={Flag} block onClick={onSetMeetingPoint}>{PLACE.setMeetingPoint}</Button>
      )}

      <div className="flex justify-center gap-2 flex-wrap">
        <Button variant="plain" onClick={onToggleExpanded} aria-expanded={expanded}>
          {expanded ? PLACE.less : PLACE.more}
        </Button>
        {expanded && <Button variant="plain" icon={MapPin} onClick={onShowOnMap}>{PLACE.showOnMap}</Button>}
      </div>
    </div>
  );
}
