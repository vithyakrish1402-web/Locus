// Request to leave, the app's side (Stage 5). In a Group that needs approval to leave (the server's
// LOCUS_LEAVE_APPROVAL_ENABLED and the Group's own switch, set for Groups made through Nearby Join;
// backend/leaveRequests.js), a member's Leave is a request the Group Lead or a moderator answers,
// approved on its own if nobody does.
//
// Off (LEAVE_APPROVAL_ENABLED false), or the Group not needing it (group-settings without
// leaveApproval), or the server answering that it is not required, Leave is exactly as in js-1.1.87,
// so the app and the server can be released in either order.

/** The app's switch. Off until the server's LOCUS_LEAVE_APPROVAL_ENABLED is on in production. */
export const LEAVE_APPROVAL_ENABLED = true;

/** How long the app waits for the server's answer before saying it could not be reached. */
export const LEAVE_REQUEST_TIMEOUT_MS = 8000;

/** Whether this Group's Leave is a request: the app's switch, and the Group's own settings say so. */
export const leaveNeedsRequest = (enabled, settings, roomCode) =>
  Boolean(enabled) && settings?.leaveApproval === true && (!settings.roomCode || settings.roomCode === roomCode);

/** The requests to show, oldest first, one per person. */
export function sortLeaveRequests(list) {
  const byUid = new Map();
  for (const request of list ?? []) if (request?.uid) byUid.set(request.uid, request);
  return [...byUid.values()].sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0));
}

/** Whether a request may be rejected from this screen: never the Group's own Commander's. */
export const mayReject = (request) => !request?.fromCommander;
