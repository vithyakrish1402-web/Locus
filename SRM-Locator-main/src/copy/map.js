// Words for the map screen (redesign Map batch). Provisional: from the design and the owner's
// decisions where given, otherwise from the Step 0 wording inventory, until the wording review.

export const TOP_BAR = {
  name: 'LOCUS',
  mapView: 'Map view',
  satelliteView: 'Satellite view',
  signOut: 'Sign out',
};

// The sharing chip under the top bar, matching your own setting (owner, 2026-10-05). Never
// "invisible" or "nobody can see you".
export const SHARING_CHIP = {
  ACTIVE: 'Sharing live with your group',
  FROZEN: 'Sharing paused · your group sees your last spot',
  GHOST: "Hidden from other members' maps",
};

// The map's right-hand controls and the meeting point button.
export const MAP_CONTROLS = {
  satellite: 'Satellite view',
  locate: 'Show where you are',
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
