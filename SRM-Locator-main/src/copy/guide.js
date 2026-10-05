// Words for the guide, "How LOCUS works" (redesign P11): five steps. Provisional: from the
// design, until the wording review. Only what LOCUS really does: no vote, no Google sign-in,
// no area alerts, no Stealth.

export const GUIDE = {
  progress: (step, total) => `${step} of ${total}`,
  skip: 'Skip',
  next: 'Next',
  done: 'Get started',
  close: 'Close',
  steps: [
    {
      title: 'Share your location with your group',
      body: 'Create a group and share its code, or join one with a code. The Group Lead approves everyone who joins.',
    },
    {
      title: 'Find each other on the map',
      body: 'See where your group is, how far away and in which direction. Add a meeting point so everyone knows where to go.',
    },
    {
      title: 'Find places and people with AR Scan',
      body: 'Hold up your phone. Labels and an arrow over the camera view point you to a building or a member of your group.',
    },
    {
      title: 'You choose what the group sees',
      body: "Live shares your movement. Paused shows your last spot. Hidden: other members won't see you on their map.",
    },
    {
      title: 'Emergency alert',
      // True in every sharing mode: SosTrigger sends the live position (App.jsx, getLocation).
      body: 'Press and hold the SOS button, then press and hold again. Your group gets a full-screen alert with your current location, whatever your sharing setting.',
    },
  ],
  // The pictures' own words.
  picture: {
    you: 'You',
    code: 'K7M2QX',
    place: 'Tech Park',
    placeDistance: '450 m',
    modes: ['Live', 'Paused', 'Hidden'],
    sharing: 'Sharing live with your group',
    sos: 'SOS',
    sosSteps: ['1 · Hold', '2 · Hold again', '3 · Group alerted'],
    meetingPoint: 'Meeting point',
  },
};
