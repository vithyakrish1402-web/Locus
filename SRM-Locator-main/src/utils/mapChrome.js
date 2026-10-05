// Where the map screen's top chrome sits, in one place, so what hangs under it (the sharing
// chip, the notifications, the route card, the banners, the group panel on a phone) lines up
// with it. CSS lengths, for style={{ top }}.

/** The top bar's top edge: under the status bar (safe area), with a 12 px margin at least. */
export const TOP_BAR_TOP = 'max(0.75rem, calc(env(safe-area-inset-top) + 0.5rem))';

/** The top bar's height (56 px, the handoff's top bar). */
export const TOP_BAR_HEIGHT = '3.5rem';

/** Just under the top bar, with an 8 px gap: the sharing chip, and the notifications over it. */
export const BELOW_TOP_BAR = `calc(${TOP_BAR_TOP} + ${TOP_BAR_HEIGHT} + 0.5rem)`;

/** Under the sharing chip (44 px) too, with an 8 px gap: the route card and the map banners. */
export const BELOW_CHIP = `calc(${BELOW_TOP_BAR} + 2.75rem + 0.5rem)`;
