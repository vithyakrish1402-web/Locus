// The group panel's resting heights on a phone (redesign Group panel batch, piece 6): peek,
// half and full, plus closed. The panel is laid out at its full height, from under the top bar
// down to the tab bar, and slides down by `y` px to rest lower; only transform moves.
//
//   full    y = 0: its top just under the top bar
//   half    its top at 45 % of the screen's height, so it covers the lower 55 %
//   peek    only its header shows, with room under it for the Emergency and meeting point
//           buttons, which float above the panel at every height and must never cover it
//   closed  y = its height: tucked away behind the tab bar
//
// A drag is let go towards where the throw would come to rest (velocity projected forward, as
// the sheets do), and settles at the nearest of those four. The projection is gentler than the
// sheets' (a deceleration rate of 0.99, iOS's "fast", not 0.998): the heights are only a couple
// of hundred pixels apart, and an ordinary let-go should rest at the nearest one, while a strong
// flick still carries on.

import { projectMomentum } from './motion';

export const HALF_SHOWS = 0.55;
export const PANEL_DECELERATION = 0.99;

/**
 * Each height's `y` (px down from full), clamped to the panel.
 * @param {{ viewport: number, panelHeight: number, peekHeight: number, tabBar?: number }} input
 *   viewport: the screen's height; panelHeight: the panel laid out at full height;
 *   peekHeight: how much of it shows at peek; tabBar: the tab bar's height under it
 */
export function panelStops({ viewport, panelHeight, peekHeight, tabBar = 64 }) {
  const clamp = (y) => Math.round(Math.min(panelHeight, Math.max(0, y)));
  const fullTop = viewport - tabBar - panelHeight;
  return {
    full: 0,
    half: clamp(viewport * (1 - HALF_SHOWS) - fullTop),
    peek: clamp(panelHeight - peekHeight),
    closed: Math.round(panelHeight),
  };
}

/**
 * The room under the panel's last row on a phone (SHEET_BOTTOM_PADDING_PX): one tab bar's height,
 * as the bar measured itself (--tab-bar-height, its content, padding and the gesture bar's
 * inset), and 2 rem more. The panel ends at the top of the tab bar, so the last row comes to rest
 * that far above it, clear of the buttons that stand over the map. (The list also ends in a
 * spacer as tall as how far the panel is slid down, which is what lets that last row be scrolled
 * up out of the part of the panel below the screen.)
 */
export const SHEET_BOTTOM_PADDING_PX = 'calc(var(--tab-bar-height) + 2rem)';

/**
 * Where a drag let go at `y` (px), moving at `velocityY` (px/s), comes to rest.
 * @returns {'full'|'half'|'peek'|'closed'}
 */
export function snapPanel(y, velocityY, stops) {
  const resting = y + projectMomentum(velocityY, PANEL_DECELERATION);
  let best = 'full';
  for (const name of ['full', 'half', 'peek', 'closed']) {
    if (Math.abs(stops[name] - resting) < Math.abs(stops[best] - resting)) best = name;
  }
  return best;
}
