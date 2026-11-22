// Nearby Join, the app's side (Stage 6). The server keeps who is discoverable, checks the distance
// and records the invites (backend/nearby.js); the app opts in, sends its position while opted in,
// scans, invites, and answers an invite.
//
// Off (NEARBY_ENABLED false), or the server answering 'disabled', the app is as in js-1.1.87 plus
// Stages 4 and 5: no toggle, no Nearby button, nothing sent. So the app and the server can be
// released in either order.

/** The app's switch. Off until the server's LOCUS_NEARBY_ENABLED is on in production. */
export const NEARBY_ENABLED = true;

/** While discoverable, a fresh lobby position at most this often (the server wants one under 20 s). */
export const NEARBY_POSITION_EVERY_MS = 5000;
/** How long the app waits for the server's answer before saying it could not be reached. */
export const NEARBY_REQUEST_TIMEOUT_MS = 8000;
/** Accept on an invite only works this long after the invite shows, so a tap meant for something
 *  else can never accept it. */
export const INVITE_ACCEPT_ARM_MS = 800;
/** The longest a scan waits for this phone's own position. */
export const NEARBY_FIX_TIMEOUT_MS = 10000;

/** What the server takes of a position: { lat, lng, accuracy } (accuracy only when the phone said). */
export function fixPayload(coords) {
  if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return null;
  const accuracy = Number.isFinite(coords.accuracy) && coords.accuracy > 0 ? coords.accuracy : undefined;
  return { lat: coords.latitude, lng: coords.longitude, ...(accuracy === undefined ? {} : { accuracy }) };
}

/** A scan's list, one row per id, keeping what is known of each invite. */
export function mergeInviteResults(rows, sent) {
  const byId = new Map((sent ?? []).map((s) => [s.id, s.inviteId]));
  return rows.map((row) => (byId.has(row.id) ? { ...row, inviteId: byId.get(row.id), status: row.status === 'idle' ? 'invited' : row.status } : row));
}

/** What an answer means for the row it is about: 'joined' | 'declined' | 'expired'. */
export const answerStatus = (answer) => (answer?.accepted ? 'joined' : answer?.expired ? 'expired' : 'declined');
