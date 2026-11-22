// Leave requests (Stage 2 of Nearby Join and timed privacy).
//
// In a Group that needs approval to leave, a member's Leave is a request that the Group's admin
// or a moderator answers, the way a join request is. Two switches decide whether a Group needs it:
//   - server-wide, LOCUS_LEAVE_APPROVAL_ENABLED (off unless "true"), and
//   - per Group, squad.settings.leaveApproval, set only for Groups made through Nearby Join
//     (markLeaveApproval). Every other Group leaves as it always has.
// Both must be on. Off, nothing here runs.
//
// Requests are kept by the person's account (uid), on the squad, with the time they are approved
// on their own if nobody answers (LEAVE_AUTO_APPROVE_MINUTES). A rejoin, a sign-out or a new
// connection finds the same request and the same deadline. Pure logic: the caller passes the time.
//
// Who may answer:
//   - the admin (whoever holds command: the Commander, or a stand-in) and moderators;
//   - a moderator's own request only the admin;
//   - nobody answers their own;
//   - a request from the Group's own Commander (one made while someone else holds command) may be
//     approved but never refused: the Group is theirs, and a stand-in holds it only for them.
// The admin never asks: their Leave is direct, as it always was.

import { defaultSettings } from './groupSettings.js';

export const LEAVE_AUTO_APPROVE_MINUTES = 15;

/** Whether leave approval is on at all. Off unless LOCUS_LEAVE_APPROVAL_ENABLED is "true". */
export const leaveApprovalEnabled = (env = process.env) => env.LOCUS_LEAVE_APPROVAL_ENABLED === 'true';

/** How long a "minute" of the auto-approve clock is: the test override only outside production. */
export function leaveMinuteMs(env = process.env) {
  const override = Number(env.LOCUS_LEAVE_MINUTE_MS);
  if (!Number.isFinite(override) || override <= 0 || env.NODE_ENV === 'production') return 60_000;
  return override;
}

/**
 * Tests only: Groups whose code starts with this are made as if through Nearby Join (Stage 3
 * makes them for real). Ignored in production, and when empty.
 */
export function testLeaveApprovalPrefix(env = process.env) {
  const prefix = env.LOCUS_TEST_LEAVE_APPROVAL_PREFIX;
  if (!prefix || env.NODE_ENV === 'production') return null;
  return prefix;
}

/** Marks a Group as one whose members need approval to leave (a Nearby Join Group). */
export function markLeaveApproval(squad) {
  if (!squad) return;
  squad.settings ??= defaultSettings();
  squad.settings.leaveApproval = true;
}

/** Whether a Leave in `squad` is a request: the server switch (`enabled`) and the Group's own. */
export const leaveNeedsApproval = (squad, enabled) => Boolean(enabled) && squad?.settings?.leaveApproval === true;

/** `uid`'s open request in `squad`, or null. */
export const leaveRequestOf = (squad, uid) => (uid && squad?.leaveRequests?.[uid]) || null;

/** Every open request in `squad`, oldest first. */
export const leaveRequestsOf = (squad) =>
  Object.values(squad?.leaveRequests ?? {}).sort((a, b) => a.requestedAt - b.requestedAt);

/**
 * Records `uid`'s request to leave, unless they already have one: asking again never moves the
 * deadline. Returns { request, created }.
 */
export function fileLeaveRequest(squad, { uid, name = null }, now, autoApproveMs) {
  squad.leaveRequests ??= Object.create(null);
  const open = squad.leaveRequests[uid];
  if (open) return { request: open, created: false };
  const request = { uid, name: typeof name === 'string' ? name.slice(0, 60) : null, requestedAt: now, deadline: now + autoApproveMs };
  squad.leaveRequests[uid] = request;
  return { request, created: true };
}

/** Takes `uid`'s request off the list. Returns it, or null when there was none. */
export function takeLeaveRequest(squad, uid) {
  const request = leaveRequestOf(squad, uid);
  if (!request) return null;
  delete squad.leaveRequests[uid];
  return request;
}

/** The uids whose requests are due to be approved on their own at `now`. */
export const dueLeaveRequests = (squad, now) =>
  leaveRequestsOf(squad).filter((request) => request.deadline <= now).map((request) => request.uid);

/**
 * Whether someone may answer a request, and how.
 * @param {{ answererRole: 'admin'|'moderator'|'member', answererUid: string|null, requesterUid: string,
 *   requesterIsModerator: boolean, requesterIsCommander: boolean, approved: boolean }} a
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function mayAnswerLeave({ answererRole, answererUid, requesterUid, requesterIsModerator, requesterIsCommander, approved }) {
  if (answererUid && answererUid === requesterUid) return { ok: false, reason: 'own-request' };
  if (answererRole !== 'admin' && answererRole !== 'moderator') return { ok: false, reason: 'not-allowed' };
  if (requesterIsModerator && answererRole !== 'admin') return { ok: false, reason: 'admin-only' };
  if (!approved && requesterIsCommander) return { ok: false, reason: 'cannot-refuse-commander' };
  return { ok: true };
}

/** Whether someone of `answererRole` sees a request at all (the same rules, approving). */
export const seesLeaveRequest = (answererRole, answererUid, request, requesterIsModerator) =>
  mayAnswerLeave({ answererRole, answererUid, requesterUid: request.uid, requesterIsModerator, requesterIsCommander: false, approved: true }).ok;
