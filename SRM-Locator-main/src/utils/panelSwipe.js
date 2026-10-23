// Whether a finger's path across the group panel is a sideways swipe between Members and
// Buildings, or something else (a scroll of the list). The panel used to switch on any
// 60 px of sideways travel and never looked at the vertical: a thumb scrolling the members
// list drifts sideways on a long flick, so scrolling down switched to Buildings.

// The least sideways travel that counts as a swipe.
export const SWIPE_MIN_DX_PX = 60;
// How many times longer the sideways travel must be than the vertical: a clearly sideways swipe.
export const SWIPE_HORIZONTAL_RATIO = 2;

/**
 * @param {{x: number, y: number}} start where the finger went down
 * @param {{x: number, y: number}} end where it came up
 * @param {boolean} scrolled whether the list scrolled during the gesture (then it was a scroll)
 * @returns {'left' | 'right' | null} the direction the finger moved, or null for no swipe
 */
export function sectionSwipe(start, end, scrolled = false) {
  if (!start || !end || scrolled) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < SWIPE_MIN_DX_PX) return null;
  if (Math.abs(dx) < SWIPE_HORIZONTAL_RATIO * Math.abs(dy)) return null;
  return dx < 0 ? 'left' : 'right';
}
