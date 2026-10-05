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
