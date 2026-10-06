// The words of AR Scan (redesign AR Scan batch): its controls, the target picker, the readout
// and its notices. One place, so the wording is reviewed whole.

export const AR_CONTROLS = {
  close: 'Close AR Scan',
  finding: 'Finding',
  chooseTarget: (name) => `Finding ${name}. Choose what to find`,
  align: 'Align',
  alignLabel: 'Align with the building in the middle of the view',
  reset: 'Reset',
  resetLabel: 'Reset the alignment',
};

// The target picker: people in your group first, then places, with search.
export const AR_PICKER = {
  title: 'What do you want to find?',
  search: 'Search places and people',
  people: 'People in your group',
  places: 'Places nearby',
  meetingPoint: 'Meeting point',
  meetingPointAt: (name) => `Meeting point · ${name}`,
  current: 'Finding now',
  nothing: (query) => `Nothing called "${query}"`,
};

// The readout at the bottom of AR Scan: how far, which way, and the walk (only along a
// real route). The direction and walk words are the place card's (copy/place.js).
export const AR_READOUT = {
  label: (name) => `How far to ${name}`,
  noFix: 'Waiting for your location',
};

// ALIGN's answers, and the compass refusal: plain words, as a notice. A refusal is an
// ordinary problem (amber), never red.
export const AR_ALIGN = {
  refused: {
    'no-landmark': 'Point at a building first, with its label in the middle of the view.',
    gps: 'Your location isn’t accurate enough to align yet. Wait a moment and try again.',
    'too-close': 'You’re too close to that building to align on it. Try one further away.',
    'not-centred': 'That building is too far from the middle. Point straight at it and try again.',
    walking: 'Stand still to align. While you walk, the direction comes from your movement.',
  },
  aligned: (name) => `Aligned on ${name}`,
  compassRefused: 'Compass access was refused, so the arrow can’t turn as you do.',
};
