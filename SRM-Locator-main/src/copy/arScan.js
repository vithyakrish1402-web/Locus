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
