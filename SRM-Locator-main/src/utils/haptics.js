// Short vibrations for moments that deserve to be felt, not heard: a press landing, a tab
// changing, a sheet snapping home. Each is a few milliseconds, so it reads as a "tick".
//
// navigator.vibrate needs the Android VIBRATE permission, which the native shell only
// declares from the APK after 1.0.0. On an older shell (and in browsers that lack the API,
// or when there has been no user gesture yet) this does nothing, which is the intended
// fallback: haptics add to the visual feedback, never replace it.

const PATTERNS = {
  tick: 8, // a press
  select: 14, // a choice that changes what's on screen (tab, segment)
  snap: [6, 30, 10], // something settling into place (a sheet)
  confirm: [10, 40, 16], // an action went through
};

export function haptic(kind = 'tick') {
  const pattern = PATTERNS[kind] ?? PATTERNS.tick;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    // Some WebViews throw instead of returning false; a missing tick is never an error.
  }
}
