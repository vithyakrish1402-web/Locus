// The words of the group panel (redesign Group panel batch): its header, the Members and
// Buildings tabs, your sharing control, the Group Lead's tools, member rows and their options,
// join requests, leaving, and the panel's states. One place, so the wording is reviewed whole.
import { spacedCode } from './access';
import { MAX_HOLD_MINUTES, wholeMinutes } from '../utils/timedPrivacy';

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

// The panel's three-point slider (components/group/PanelStops.jsx): each notch's name.
export const PANEL_STOPS = {
  label: 'Panel height',
  peek: 'Show members',
  half: 'Show options',
  full: 'Show everything',
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

// Timed Pause and Hidden (Stage 4, utils/timedPrivacy.js). Plain words for how long, how much is
// left, and when the group sees you again. Only ever about your own sharing.
const minutesWord = (m) => `${m} min`;
export const TIMED_PRIVACY = {
  pickTitle: { FROZEN: 'Pause for how long?', GHOST: 'Hide for how long?' },
  minutes: minutesWord,
  cancel: 'Cancel',
  allowanceLeft: (ms) => `${minutesWord(wholeMinutes(ms))} of Pause and Hidden left this hour`,
  allowanceNone: `You've used all ${MAX_HOLD_MINUTES} minutes of Pause and Hidden for this hour. More frees up as the hour goes on.`,
  refused: (ms) => (wholeMinutes(ms) >= 1
    ? `Only ${minutesWord(wholeMinutes(ms))} of Pause and Hidden is left this hour. Pick that or less.`
    : `You've used all ${MAX_HOLD_MINUTES} minutes of Pause and Hidden for this hour. More frees up as the hour goes on.`),
  unreachable: "Couldn't reach the server, so nothing changed. Try again in a moment.",
  countdown: { FROZEN: (left, clock) => `Paused for ${left} more, until ${clock}`, GHOST: (left, clock) => `Hidden for ${left} more, until ${clock}` },
  headsUp: (clock) => `You'll be visible again at ${clock}`,
  again: { FROZEN: 'Pause again', GHOST: 'Hide again' },
  ended: {
    expired: "You're visible to your group again.",
    resumed: "You're visible to your group again.",
    sos: "You're visible to your group again: sharing resumed because you sent an SOS.",
  },
};

// A member's row and their options sheet.
export const MEMBERS = {
  liveNow: 'Live now',
  live: 'Live',
  paused: 'Paused',
  // No coordinates have come through for them yet (owner's wording).
  waiting: 'Waiting for location',
  // A timed Pause or Hidden (Stage 4), in this phone's own clock.
  pausedUntil: (clock) => `Paused until ${clock}`,
  hiddenUntil: (clock) => `Hidden until ${clock}`,
  lastUpdate: (minutes) => `Last update ${minutes} min ago`,
  withYou: 'With you',
  lostConnection: (elapsed) => `Lost connection ${elapsed} ago`,
  lastSeen: (elapsed) => `Last seen ${elapsed} ago`,
  options: (name) => `Options for ${name}`,
  battery: (percent) => `Battery ${percent}%`,
  lowBattery: (percent) => `Low battery, ${percent}%`,
  speed: (kmh) => `${kmh} km/h`,
};

export const MEMBER_OPTIONS = {
  navigate: (first) => `Navigate to ${first}`,
  ping: (first) => `Ping ${first}`,
  showOnMap: 'Show on map',
  arScan: 'Find with AR Scan',
  removeAndBlock: 'Remove and block',
  remove: 'Remove from group',
  makeModerator: 'Make moderator',
  removeModerator: 'Remove as moderator',
  cancel: 'Cancel',
  // The line under each action, so every row is the same height.
  makeModeratorHelp: 'Can let people in and remove members',
  removeModeratorHelp: 'Back to a member, without the moderator tools',
  removeHelp: 'They can ask to join again',
  removeAndBlockHelp: "They can't ask to join again until you unblock them",
};

// Trusted friends (utils/friends.js): only they, the Group Lead and moderators hear your SOS.
export const FRIENDS = {
  badge: 'Trusted friend',
  add: 'Add as trusted friend',
  addHelp: 'Trusted friends hear your SOS. The Group Lead and moderators always do.',
  sent: 'Cancel friend request',
  sentHelp: 'Waiting for them to accept',
  acceptHelp: 'They asked to be trusted friends',
  removeHelp: 'You stop hearing each other\'s SOS',
  accept: 'Accept',
  acceptRequest: 'Accept friend request',
  decline: 'Decline',
  remove: 'Remove trusted friend',
  acceptFor: (name) => `Accept ${name}`,
  declineFor: (name) => `Decline ${name}`,
  requestsButton: (count) => (count === 1 ? '1 friend request' : `${count} friend requests`),
  requestsTitle: 'Friend requests',
  requestsHelp: 'A trusted friend hears your SOS, and you hear theirs. Either of you can end it at any time.',
  wants: 'Wants to be trusted friends',
  noRequests: 'No requests are waiting.',
  someone: 'Someone',
  failed: "That didn't go through. Check your connection and try again.",
};

// The roles a member can have (backend/groupRoles.js), as their card shows them.
export const ROLES = {
  admin: 'Group Lead',
  moderator: 'Moderator',
};

// Removing and blocking, confirmed. A blocked person can be unblocked from Blocked people.
export const REMOVE_AND_BLOCK = {
  title: (name) => `Remove and block ${name}?`,
  body: (first) => `${first} is removed from your group straight away and can't ask to join again until you unblock them.`,
  confirm: 'Remove and block',
  cancel: 'Cancel',
};

// Removing without blocking, confirmed: they can ask to join again.
export const REMOVE_MEMBER = {
  title: (name) => `Remove ${name}?`,
  body: (first) => `${first} is removed from your group straight away. They can ask to join again, and you or a moderator decide.`,
  confirm: 'Remove',
  cancel: 'Cancel',
};

// Something the server would not let this person do (their role changed meanwhile, or the
// person they acted on is the Group Lead or a moderator).
export const ROLE_REFUSED = "That didn't work. Only the Group Lead and moderators can do this, and not to each other.";

// The activity log (backend/activityLog.js): for the Group Lead and moderators.
export const ACTIVITY_LOG = {
  title: 'Activity log',
  help: 'When people hid their location and came back, left, lost their connection, or were removed. It is kept on the server and is lost if the server restarts.',
  empty: 'Nothing has happened yet.',
  export: 'Export log',
  exportFailed: "Couldn't export the log.",
  copied: 'The log is copied. Paste it into a note or a message to keep it.',
  kinds: {
    'went-hidden': 'Hid their location',
    'back-from-hidden': 'Showed their location again',
    'went-paused': 'Paused their location',
    'back-from-paused': 'Shared their location again after a pause',
    'left-group': 'Left the group',
    'connection-lost': 'Lost connection',
    kicked: 'Was removed',
    blocked: 'Was removed and blocked',
    unblocked: 'Was unblocked',
  },
  by: (name) => `by ${name}`,
  someone: 'Someone',
};

// Blocked people, for the Group Lead to unblock.
export const BLOCKED = {
  title: 'Blocked people',
  help: "They can't ask to join this group until they are unblocked. The list is kept on the server and is lost if the server restarts.",
  empty: 'No one is blocked.',
  unblock: 'Unblock',
  unblockFor: (name) => `Unblock ${name}`,
  someone: 'Someone',
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
  activityLog: 'Activity log',
  blocked: 'Blocked people',
};

// The Group Lead's emergency alert controls (item 5): SOS on or off for the group, and the
// least time between two alerts from one person.
export const SOS_CONTROLS = {
  switchLabel: 'Emergency alerts',
  on: 'Anyone in the group can send an SOS.',
  off: 'Off: nobody in the group can send an SOS.',
  cooldownLabel: "Time between one person's alerts",
  minutes: (ms) => `${Math.round(ms / 60000)} min`,
  notCommander: 'Only the person who set up the group can change this.',
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

// Request to leave (Stage 5, utils/leaveRequests.js): a member's own request, in a Group that needs
// approval to leave. Plain and calm: nobody is trapped, and nothing is said about anyone else.
export const LEAVE_REQUEST = {
  button: 'Request to leave',
  confirmTitle: 'Ask to leave the group?',
  confirmBody: 'The Group Lead or a moderator is asked to let you go. If nobody answers, you leave automatically after 15 minutes. Until then you stay in the group and keep sharing as you are now.',
  confirm: 'Request to leave',
  stay: 'Stay in the group',
  waitingTitle: 'Waiting for the Group Lead',
  waitingBody: (left, clock) => `If nobody answers, you leave automatically in ${left}, at ${clock}.`,
  cancel: 'Cancel request',
  sent: 'Your request to leave was sent to the Group Lead.',
  cancelled: 'You cancelled your request to leave. You stay in the group and keep sharing as before.',
  approved: "Your request to leave was approved. You've left the group.",
  approvedAuto: "Nobody answered your request to leave in time, so you've left the group.",
  rejected: (byName) => (byName
    ? `${byName} turned down your request to leave. You stay in the group.`
    : 'Your request to leave was turned down. You stay in the group.'),
  gone: 'Your request to leave is no longer waiting. You stay in the group.',
  tookCommand: 'You now lead the group, so your request to leave was cancelled. You can leave directly.',
  signedOut: "You've signed out. Your location is no longer shared, but you stay a member of the group until your request to leave is approved.",
  unreachable: "Couldn't reach the server, so nothing was sent. Try again in a moment.",
};

// Leave requests, for the Group Lead and moderators: shown in the join requests sheet, in its style.
export const LEAVE_REQUESTS = {
  tile: 'Requests',
  leaveSection: 'Asking to leave',
  joinSection: 'Asking to join',
  wants: 'Wants to leave',
  autoIn: (left, clock) => `Leaves automatically in ${left}, at ${clock}`,
  approve: 'Approve',
  reject: 'Reject',
  approveFor: (name) => `Let ${name} leave`,
  rejectFor: (name) => `Ask ${name} to stay`,
  commanderRule: "This is the group's own Group Lead. Their request can be approved or left to run out, but not rejected.",
  moderatorRule: "A moderator's request: only you, as Group Lead, can answer it.",
  newNotice: (name) => `${name || 'A member'} is asking to leave the group`,
  gone: 'That request is no longer waiting.',
  refused: {
    'cannot-refuse-commander': "The Group Lead's own request can't be rejected.",
    'admin-only': "Only the Group Lead can answer a moderator's request.",
    'not-allowed': 'Only the Group Lead and moderators can answer requests to leave.',
    'own-request': "You can't answer your own request.",
  },
};

// Nearby Join (Stage 6, utils/nearby.js). Names only, never where anyone is; nobody joins without
// their own tap; and it is said so, in plain words, wherever it matters.
export const NEARBY = {
  // In the lobby, for someone in no group.
  toggle: 'Let people nearby find me',
  toggleHelp: 'Only your name is shown, only to someone within about 15 m who presses Nearby. Nobody can add you to a group without your own tap.',
  permissionHelp: 'Turning this on asks for your location. It is used only to tell whether you are close to the person pressing Nearby, and only while this is on.',
  permissionDenied: "LOCUS can't see your location, so people nearby can't find you. Allow location for LOCUS in your phone's settings to use this.",
  finding: 'Finding your location…',
  visible: 'Visible to people nearby',
  turnOff: 'Turn off',
  stoppedHidden: 'People nearby can no longer find you: LOCUS stopped while the app was in the background.',
  unavailable: "Nearby isn't available right now.",
  // The Nearby button.
  button: 'Nearby',
  startButton: 'Start a group with people nearby',
  startHelp: "You'll be the Group Lead. LOCUS looks for people within about 15 m who have let people nearby find them.",
  title: 'People nearby',
  scanning: 'Looking for people nearby…',
  eachAccepts: 'Each person gets an invite and joins only if they accept it.',
  addAll: (count) => `Add all ${count}`,
  inviteSelected: (count) => `Invite ${count}`,
  scanAgain: 'Scan again',
  empty: 'Nobody nearby has let people find them right now. They can turn on “Let people nearby find me” in LOCUS, then you can scan again.',
  tooRough: "Your own position is too rough right now to tell who is close. Try moving outdoors or near a window, then scan again.",
  tooMany: "You've scanned a lot just now. Try again in a moment.",
  unreachable: "Couldn't reach the server. Try again in a moment.",
  rowStatus: { invited: 'Invited', joined: 'Joined', declined: 'Declined', expired: 'Invite expired' },
  select: (name) => `Select ${name}`,
  joinedNotice: (name) => `${name || 'Someone'} joined your group`,
  declinedNotice: (name) => `${name || 'Someone'} declined your invite`,
  expiredNotice: (name) => `${name || 'Someone'} didn't answer in time; the invite expired`,
  // An invite.
  inviteTitle: (from) => `Join ${from || 'a'}'s group?`,
  inviteBody: (from) => `${from || 'Someone nearby'} invited you to their LOCUS group. If you join, the group sees your location on its map. Leaving it may need the Group Lead's approval.`,
  inviteExpiresIn: (left) => `This invite expires in ${left}.`,
  accept: 'Join group',
  decline: 'Not now',
  inviteExpired: 'That invite has expired. You can ask them to send another.',
  inviteUsed: 'That invite has already been answered.',
  inviteGone: 'That invite is no longer open.',
  inviteBlocked: "You can't join that group.",
  inviteInGroup: "You're already in a group, so the invite wasn't used.",
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
  // The Group Lead only (backend/groupRoles.js: admitAll).
  admitAll: (count) => `Admit all ${count}`,
  declineFor: (name) => `Decline ${name}`,
  emptyTitle: 'No one is waiting',
  emptyBody: (code) => `When someone asks to join with the code ${spacedCode(code)}, they show here for you to approve.`,
};

// The peek height's summary line under the header.
export const PEEK = {
  members: 'Everyone in the group',
  you: 'You',
  justYou: 'Just you so far',
  summary: ({ live = 0, paused = 0, waiting = 0, lost = 0 }) => [
    live && `${live} live`,
    paused && `${paused} paused`,
    waiting && `${waiting} waiting for location`,
    lost && `${lost} lost connection`,
  ].filter(Boolean).join(' · '),
};

// The members list's heading and states: loading, empty, and a search that finds no one.
export const MEMBERS_LIST = {
  // Everyone in the group, you included (the empty group is "Members · 1": just you).
  heading: (count) => `Members · ${count}`,
  loadingHeading: 'Members',
  loading: 'Loading…',
  updatedJustNow: 'Updated just now',
  updated: (minutes) => `Updated ${minutes} min ago`,
  emptyTitle: 'Just you so far',
  emptyLead: (code) => `Share the code ${spacedCode(code)}. You approve each person before they can see the group.`,
  emptyMember: (code) => `Share the code ${spacedCode(code)}. The Group Lead approves each person before they can see the group.`,
  copyCode: 'Copy code',
  codeCopied: 'Code copied',
  noMatch: (query) => `No one called "${query}"`,
};

// The Buildings list (Stop 2 leftovers: a search that found nothing showed a blank list).
export const BUILDINGS_LIST = {
  noMatch: (query) => `No building called "${query}"`,
  // Nothing in the chosen category, but the search does match places in others.
  noMatchHere: (query, category, elsewhere) =>
    `Nothing called "${query}" in ${category}. ${elsewhere === 1 ? '1 match' : `${elsewhere} matches`} in other categories.`,
};
