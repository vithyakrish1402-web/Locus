// Is the camera view too dark for AR Scan's labels? (redesign AR Scan batch, piece 9)
//
// The hook (hooks/useCameraDarkness.js) shrinks one camera frame a second to a tiny
// SAMPLE_W x SAMPLE_H picture, takes its average brightness here, and feeds it to
// nextDarkness, which only changes its mind after several samples in a row. So the labels
// don't flicker as the phone sweeps past a shadow, and a hand over the lens hides them only
// after a few seconds and shows them again a couple of seconds after it moves away.
//
// A sample that couldn't be taken (null) always means "not dark": if sampling fails,
// nothing hides.

// The tiny picture each sample is shrunk to: 192 pixels, 768 bytes to read back.
export const SAMPLE_W = 16;
export const SAMPLE_H = 12;
// One sample a second.
export const SAMPLE_EVERY_MS = 1000;
// Average brightness (0-255) below which a sample counts as dark, and above which it counts
// as light again. The gap between them is the leeway: a sample in between changes nothing.
export const DARK_BELOW = 24;
export const LIGHT_ABOVE = 40;
// How many dark samples in a row before the labels hide, and light ones before they return.
export const DARK_AFTER = 3;
export const LIGHT_AFTER = 2;

export const NOT_DARK = { dark: false, run: 0 };

/** Average brightness (0-255) of RGBA pixel data, by the usual luma weights. */
export function meanLuma(data) {
  if (!data || data.length < 4) return null;
  let sum = 0;
  const pixels = Math.floor(data.length / 4);
  for (let i = 0; i < pixels * 4; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / pixels;
}

/**
 * The next darkness state from one sample's brightness. `run` counts samples in a row that
 * point the other way from the current state; it flips once it reaches DARK_AFTER (to dark)
 * or LIGHT_AFTER (back to light). A sample in the leeway band resets the run; a missing one
 * (null: sampling failed) resets everything to not dark.
 */
export function nextDarkness(state, luma) {
  if (!Number.isFinite(luma)) return NOT_DARK;
  if (!state.dark) {
    if (luma >= DARK_BELOW) return NOT_DARK;
    const run = state.run + 1;
    return run >= DARK_AFTER ? { dark: true, run: 0 } : { dark: false, run };
  }
  if (luma <= LIGHT_ABOVE) return { dark: true, run: 0 };
  const run = state.run + 1;
  return run >= LIGHT_AFTER ? NOT_DARK : { dark: true, run };
}
