// Which navigation a build contains, so a phone can say. The turn-by-turn engine
// (hooks/useNavigationController.js) is the same in every build that has it; what differs is the
// screen on top of it. Bump the id when the navigation screen changes.
//
//   nav-hud-1  the 2026-10-14 design navigation: separate cards, a speed badge, the whole route line
//   nav-hud-2  one top panel, dot + chevron pointer, no speed badge, Auto / Re-center in the
//              toolbar, the route line behind you trimmed away (claude/nav-overlay-locus)
export const NAV_BUILD = 'nav-hud-2';

/** One line in the console at launch: `adb logcat | grep "navigation build"` on a phone. */
export const logNavBuild = () => console.info(`[LOCUS] navigation build: ${NAV_BUILD}`);
