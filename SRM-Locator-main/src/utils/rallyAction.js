// What the place card's Rally button does on a tap. Any member can set the group's rally point
// (the server's rule); once it is on this place, a tap offers to clear it, which only the
// Commander or whoever set it may do (clear-waypoint in backend/server.js).
//
//   'join-first'   not in a group: say so, set nothing
//   'set'          ask to make this place the rally point
//   'clear'        it is already here: ask to clear it
//   'cannot-clear' it is already here, but not yours to clear: say so
export function rallyAction({ inGroup, isHere, canClear }) {
  if (!inGroup) return 'join-first';
  if (!isHere) return 'set';
  return canClear ? 'clear' : 'cannot-clear';
}

/** The rally point is this place (the waypoint carries the place's own coordinates). */
export const rallyIsAt = (waypoint, place) => Boolean(
  waypoint && place && waypoint.lat === place.lat && waypoint.lng === place.lng,
);
