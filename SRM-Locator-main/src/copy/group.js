// The words of the group panel (redesign Group panel batch): its header, the Members and
// Buildings tabs, your sharing control, the Group Lead's tools, member rows and their options,
// join requests, leaving, and the panel's states. One place, so the wording is reviewed whole.
import { spacedCode } from './access';

export const GROUP_HEADER = {
  // There is no group name in the data: every group is "Your group" (owner, 2026-10-05).
  title: 'Your group',
  lead: "You're the Group Lead",
  member: 'Member',
  code: (code) => `Code ${spacedCode(code)}`,
  copy: 'Copy group code',
  copied: 'Group code copied',
  // The peek height's line for a Group Lead with requests waiting (owner's choice).
  requests: (count) => (count === 1 ? '1 join request' : `${count} join requests`),
};

export const GROUP_TABS = {
  label: 'Group panel',
  members: 'Members',
  buildings: 'Buildings',
  searchMembers: 'Search members',
  searchBuildings: 'Search buildings',
};

// Your own sharing: the segmented control and its helper line (the old ACTIVE / FROZEN / GHOST).
const EVERY = { eco: 'every 15 seconds', standard: 'every 5 seconds', max: 'every second' };
export const SHARING_CONTROL = {
  label: 'Your location',
  options: { ACTIVE: 'Live', FROZEN: 'Paused', GHOST: 'Hidden' },
  help: {
    ACTIVE: (polling) => `The group sees you move, updated ${EVERY[polling] ?? EVERY.standard}.`,
    // Live, before the first fix: nothing has been shared yet.
    waiting: "Your location will be shared live once it's found.",
    FROZEN: 'The group sees the last place you shared, not where you are now.',
    // Paused before any fix: the pause took no spot.
    pausedNoSpot: "No spot has been shared yet, so the group won't see you on their map.",
    GHOST: "Other members won't see you on their map.",
  },
};

// A member's row and their options sheet.
export const MEMBERS = {
  liveNow: 'Live now',
  live: 'Live',
  paused: 'Paused',
  // No coordinates have come through for them yet (owner's wording).
  waiting: 'Waiting for location',
  lastUpdate: (minutes) => `Last update ${minutes} min ago`,
  withYou: 'With you',
  lostConnection: (elapsed) => `Lost connection ${elapsed} ago`,
  lastSeen: (elapsed) => `Last seen ${elapsed} ago`,
  options: (name) => `Options for ${name}`,
  battery: (percent) => `Battery ${percent}%`,
  speed: (kmh) => `${kmh} km/h`,
};

export const MEMBER_OPTIONS = {
  ping: (first) => `Ping ${first}`,
  showOnMap: 'Show on map',
  arScan: 'Find with AR Scan',
  removeAndBlock: 'Remove and block',
  cancel: 'Cancel',
};

// The Group Lead's confirmation. It never mentions unblocking: there is no Unblock (owner).
export const REMOVE_AND_BLOCK = {
  title: (name) => `Remove and block ${name}?`,
  body: (first) => `${first} is removed from your group straight away and can't ask to join again.`,
  confirm: 'Remove and block',
  cancel: 'Cancel',
};

/** A member's first name, for "Ping Meera" ("Someone" when they have no name). */
export const firstName = (name) => ((typeof name === 'string' && name.trim()) ? name.trim().split(/\s+/)[0] : 'Someone');

// The Group Lead's tools: Join requests, Refresh locations and Meeting point.
export const LEAD_TOOLS = {
  joinRequests: 'Join requests',
  waiting: (count) => `${count} waiting`,
  refresh: 'Refresh locations',
  refreshing: 'Refreshing…',
  meetingPoint: 'Meeting point',
  cancelMeetingPoint: 'Cancel',
  removeMeetingPoint: 'Remove meeting point',
};

// Refresh locations that didn't work: an amber notice with Retry, never red.
export const REFRESH_FAILED = {
  title: "Couldn't refresh locations.",
  retry: 'Retry',
  notConnected: "You're not connected to the server. It's reconnecting, so try again in a moment.",
  noResponse: 'No answer from the server. Check your connection and try again.',
  notLead: 'Only the Group Lead can refresh locations.',
  notInGroup: 'The server has no record of this group for this phone. Leave the group and join it again.',
  refused: "The server didn't refresh the locations.",
};

// Leaving, for everyone, behind a confirmation. A Group Lead is told what happens to the
// group: leadership passes to another member, or, alone, the group ends (the server deletes
// an empty group).
export const LEAVE_GROUP = {
  button: 'Leave group',
  title: 'Leave the group?',
  body: (code) => `You'll stop sharing your location with the group and won't see its members on your map. To come back, ask to join again with the code ${spacedCode(code)}.`,
  leadPasses: "You're the Group Lead: leadership passes to another member of the group.",
  leadAlone: "You're the only one in it, so the group ends when you leave.",
  confirm: 'Leave group',
  cancel: 'Stay in the group',
};

// The Group Lead's join requests: Waiting only (there is no Unblock, so no Blocked tab).
export const JOIN_REQUESTS = {
  title: 'Join requests',
  help: 'Approved people can see the group on the map and are seen by it.',
  // A request carries no time ("Asked 1 min ago" is on the Later list).
  wants: 'Wants to join',
  approve: 'Approve',
  decline: 'Decline',
  approveFor: (name) => `Approve ${name}`,
  declineFor: (name) => `Decline ${name}`,
  emptyTitle: 'No one is waiting',
  emptyBody: (code) => `When someone asks to join with the code ${spacedCode(code)}, they show here for you to approve.`,
};

// The peek height's summary line under the header.
export const PEEK = {
  justYou: 'Just you so far',
  summary: ({ live = 0, paused = 0, waiting = 0, lost = 0 }) => [
    live && `${live} live`,
    paused && `${paused} paused`,
    waiting && `${waiting} waiting for location`,
    lost && `${lost} lost connection`,
  ].filter(Boolean).join(' · '),
};
