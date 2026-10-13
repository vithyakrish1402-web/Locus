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
  leadIsBack: 'The Group Lead is back. You are a member again.',
  removedByLead: 'You were removed from the group.',
  removedByVote: "The group's members voted to remove you.",
  routePublished: (from, to) => `Route ${from} → ${to} published.`,
};

// Notifications from the operating system, shown only while LOCUS is in the background.
export const OS_NOTICES = {
  ping: { title: 'Ping', body: (senderName) => `${nameOr(senderName, 'A group member')} is pinging you.` },
  meetingPoint: { title: 'New meeting point', body: 'Open LOCUS to see it on the map.' },
};
