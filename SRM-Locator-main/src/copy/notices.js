// Words for the notifications (redesign P4). Provisional: from the design where it shows
// them, otherwise from the Step 0 wording inventory, until the wording review.
//
// Names are shown as they were sent: never put into capitals, never "he" or "she" (the app
// doesn't know).

const nameOr = (name, fallback) => (typeof name === 'string' && name.trim() ? name.trim() : fallback);

export const NOTICES = {
  // receive-ping carries only the sender's name, so no distance or direction (see
  // docs/step0-followups.md, "Later").
  ping: (senderName) => `${nameOr(senderName, 'A group member')} is pinging you`,
  signalLost: {
    title: (name) => `${nameOr(name, 'A group member')} lost connection`,
    body: 'Showing where they were last.',
  },
  meetingPoint: {
    title: 'New meeting point',
    body: 'Tap to see it on the map.',
    gone: 'That meeting point has been removed.',
  },
  // The place card's Navigate and Rally buttons.
  navigate: { waitingForLocation: 'Waiting for your location' },
  rally: {
    joinFirst: 'Join a group to set a rally point',
    cannotClear: 'Only the Group Lead, or whoever set it, can clear the rally point.',
    set: (place) => `${place} is now the rally point.`,
    cleared: 'Rally point cleared.',
  },
  leadIsBack: 'The Group Lead is back. You are a member again.',
  removedByLead: 'You were removed from the group.',
  removedByVote: "The group's members voted to remove you.",
  routePublished: (from, to) => `Route ${from} → ${to} published.`,
  placeAdded: (name) => `${name} added for everyone.`,
  placeRemoved: (name) => `${name} removed.`,
  placeNotRemoved: 'Could not remove that place. Check your connection and try again.',
};

// Notifications from the operating system, shown only while LOCUS is in the background.
export const OS_NOTICES = {
  ping: { title: 'Ping', body: (senderName) => `${nameOr(senderName, 'A group member')} is pinging you.` },
  meetingPoint: { title: 'New meeting point', body: 'Open LOCUS to see it on the map.' },
};
