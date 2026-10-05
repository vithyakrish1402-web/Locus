import React from 'react';
import { locateTarget } from '../utils/direction';
import { buildingDetails } from '../utils/buildingInfo';
import { PLACE, directionLabel, distanceLabel } from '../copy/place';

// "More about this place", opened in place inside the place card (PlaceCard): the details a
// building has, as label and value rows, and how far it is from you. Only the fields a
// building has are shown; with none it says PLACE.noDetails, so it is never blank. The
// distance and direction come from the same helper as the group list, so the two agree.

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-4 py-1">
      <dt className="text-body text-text-secondary">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

export default function BuildingInfo({ building, me, heading, headingLive }) {
  const details = buildingDetails(building);
  const where = locateTarget(me, building, { heading, headingLive });
  const direction = directionLabel(where);

  return (
    <div data-testid="building-info" className="flex flex-col gap-2 font-ui">
      <p className="text-label text-text-secondary">{PLACE.more}</p>
      {details.description && <p className="text-body text-text">{details.description}</p>}
      {!details.hasDetails && <p className="text-body text-text-secondary">{PLACE.noDetails}</p>}
      <dl>
        {details.departments.length > 0 && <Row label={PLACE.departments}>{details.departments.join(', ')}</Row>}
        {details.floors && <Row label={PLACE.floors}>{details.floors}</Row>}
        {details.facilities.length > 0 && <Row label={PLACE.facilities}>{details.facilities.join(', ')}</Row>}
        {where && (
          <Row label={PLACE.fromYou}>
            {where.here ? direction : [distanceLabel(where.shownDistance), direction].filter(Boolean).join(' · ')}
          </Row>
        )}
      </dl>
    </div>
  );
}
