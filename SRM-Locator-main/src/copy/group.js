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
