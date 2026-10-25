// Words for the map screen (redesign Map batch). Provisional: from the design and the owner's
// decisions where given, otherwise from the Step 0 wording inventory, until the wording review.

export const TOP_BAR = {
  name: 'LOCUS',
  mapView: 'Map view',
  satelliteView: 'Satellite view',
  signOut: 'Sign out',
  // The search beside the name: find a building or place.
  search: 'Search buildings and places',
  searchPlaceholder: 'Search places…',
  clearSearch: 'Close search',
};

// The sharing chip under the top bar, matching your own setting (owner, 2026-10-05). Never
// "invisible" or "nobody can see you".
export const SHARING_CHIP = {
  ACTIVE: 'Sharing live with your group',
  FROZEN: 'Sharing paused · your group sees your last spot',
  GHOST: "Hidden from other members' maps",
  // Live, but no fix yet (or the location explainer still open): nothing is being shared.
  waiting: 'Waiting for your location',
  // Paused before any fix: the pause took no spot, so the group sees nothing.
  pausedNoSpot: 'Sharing paused · no spot shared yet',
};

// The same, in one word: beside the dot once the chip has folded, so it is never a bare dot.
export const SHARING_CHIP_SHORT = {
  ACTIVE: 'Live',
  FROZEN: 'Paused',
  GHOST: 'Hidden',
  waiting: 'Waiting',
  pausedNoSpot: 'Paused',
};

// The map's right-hand controls and the meeting point button.
export const MAP_CONTROLS = {
  satellite: 'Satellite view',
  locate: 'Show where you are',
  autoOn: 'Auto-centre is on: tap to stop following you',
  autoOff: 'Auto-centre is off: tap to keep the map on you',
  campus: 'Show the whole campus',
  settings: 'Settings',
  placeMeetingPoint: 'Place a meeting point',
  cancelMeetingPoint: 'Cancel placing a meeting point',
};

// The phone's bottom tab bar.
export const TABS = { map: 'Map', scan: 'Scan', group: 'Group' };

// Markers on the map. Names as they were sent (never put into capitals).
export const MARKERS = {
  memberPlate: (name, distance) => (distance ? `${name} · ${distance}` : name),
  memberPaused: (name) => `${name} · paused`,
  // Still connected, but no new position for a while (utils/memberStatus.js says when).
  memberStale: (name, minutes) => `${name} · last update ${minutes} min ago`,
  lostConnection: (name, elapsed) => `${name} · lost connection ${elapsed} ago`,
  lastSeen: (name, elapsed) => `${name} · last seen ${elapsed} ago`,
  lostConnectionTitle: (name) => `Lost connection: ${name}`,
  lastSeenTitle: (name) => `Last seen: ${name}`,
  lastBattery: (battery) => `Last seen with ${battery}% battery.`,
  someone: 'A group member',
  meetingPoint: 'Meeting point',
  meetingPointPlate: (name) => (name && name !== 'RALLY POINT' ? `Meeting point · ${name}` : 'Meeting point'),
  findWithAr: 'Find with AR Scan',
  removeMeetingPoint: 'Remove meeting point',
};

// Your own route (Navigate).
export const ROUTE_CARD = {
  walkingTo: (place) => `Walking to ${place}`,
  fromYou: 'from your location',
  from: (place) => `from ${place}`,
  choosing: 'Choose where to go',
  choosingHelp: (start) => (start ? `From ${start}. Pick a place, then Set as destination.` : 'Pick a place, then Set as destination.'),
  end: 'End route',
};

// Banners on the map.
export const MAP_BANNERS = {
  placeMeetingPoint: 'Tap the map to place a meeting point',
  cancel: 'Cancel',
  locationOff: {
    title: 'Location is off',
    body: 'Turn it on so your group can find you and you can see how far away they are.',
  },
  noFix: {
    title: "Can't find your location",
    body: "Your group can't see you until your phone finds where you are. LOCUS keeps trying.",
  },
  turnOn: 'Turn on location',
  dismiss: 'Dismiss',
  finding: 'Finding your location…',
};

// The buildings list (the group panel's other tab).
export const BUILDING_LIST = {
  away: (distance) => `${distance} away`,
  here: 'You are here',
  arScan: 'AR Scan',
  arScanFor: (place) => `AR Scan to ${place}`,
  navigate: 'Navigate',
  navigateTo: (place) => `Navigate to ${place}`,
};
