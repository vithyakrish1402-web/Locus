// Words for the place card, "More about this place" and the meeting point confirmation
// (redesign P5c). Provisional: from the design where it shows them, otherwise from the Step 0
// wording inventory, until the wording review.

const COMPASS_WORDS = {
  N: 'north', NE: 'north-east', E: 'east', SE: 'south-east',
  S: 'south', SW: 'south-west', W: 'west', NW: 'north-west',
};

// The walking pace the route card already assumes (App.jsx, calculateActualRoute): ~5 km/h.
const WALKING_SPEED_MPS = 1.4;

/** "Academic" for ACADEMIC: a category is one word from the campus data. */
export const categoryLabel = (category) => {
  const word = String(category ?? '').trim().toLowerCase().replace(/_/g, ' ');
  return word ? word[0].toUpperCase() + word.slice(1) : '';
};

/** "450 m", "1.6 km", from locateTarget's shownDistance ({ value, unit: 'M' | 'KM' }). */
export const distanceLabel = (shown) => (shown ? `${shown.value} ${shown.unit.toLowerCase()}` : '');

/**
 * Where a place is, in words, from locateTarget: "1 o'clock" while the compass is live,
 * otherwise a compass direction ("to the north-east"). Never in capitals.
 */
export function directionLabel(where) {
  if (!where) return '';
  if (where.here) return 'You are here';
  if (where.clock) {
    if (where.clock.hour === 12) return 'straight ahead';
    if (where.clock.hour === 6) return 'behind you';
    return `${where.clock.hour} o’clock`;
  }
  const point = /BEARING (\w+)/.exec(where.direction ?? '')?.[1];
  return point && COMPASS_WORDS[point] ? `to the ${COMPASS_WORDS[point]}` : '';
}

/** "about 6 min on foot" for a straight-line distance in metres. */
export function walkLabel(metres) {
  if (!Number.isFinite(metres)) return '';
  const minutes = Math.max(1, Math.round(metres / WALKING_SPEED_MPS / 60));
  return `about ${minutes} min on foot`;
}

export const PLACE = {
  close: 'Close',
  navigate: 'Navigate',
  arScan: 'AR Scan',
  // Rally is the group's meeting point (the server calls it the Rally Point).
  rally: 'Rally',
  rallySet: 'Rally set',
  rallyLabel: 'Set as rally point',
  rallyClearLabel: 'Rally point set here. Clear it',
  // A card for something with no known position (components/PlaceCard.jsx): its actions are off.
  noLocation: "No known location yet, so you can't navigate, rally or scan to it.",
  more: 'More about this place',
  departments: 'Departments',
  floors: 'Floors',
  facilities: 'Facilities',
  fromYou: 'From you',
  noDetails: 'No more details for this place yet.',
};

export const MEETING_POINT_CONFIRM = {
  title: (place) => `Set ${place} as the meeting point for your group?`,
  body: 'Everyone in your group sees it on their map and gets a notice.',
  confirm: 'Set meeting point',
  cancel: 'Cancel',
};

export const RALLY_CLEAR_CONFIRM = {
  title: (place) => `Clear ${place} as the rally point?`,
  body: 'It goes from everyone’s map in your group.',
  confirm: 'Clear rally point',
  cancel: 'Keep it',
};

export const ROUTE = {
  end: 'End route',
};
