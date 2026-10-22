// The strip at the top of the screen that the status bar (clock, signal, battery) covers, read
// from the same CSS the Settings cover uses (--top-cover-height in index.css), so every screen
// that has to stay clear of the status bar agrees on how tall it is.

/** The least gap kept between the status bar and AR Scan's tags, in CSS pixels. */
export const AR_TAG_GAP_BELOW_STATUS_BAR_PX = 8;

/**
 * The status bar's height in CSS pixels right now, or 0 when there is none (a desktop browser,
 * a test). Measured through a throwaway element so the browser resolves env() and var() itself.
 */
export function readTopCoverPx() {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:var(--top-cover-height, 0px)';
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height || probe.offsetHeight || 0;
  probe.remove();
  return Math.max(0, Math.round(px));
}

/**
 * AR_TAG_TOP_SAFE_MARGIN_PX: where AR Scan's tags may reach at the top of the screen, as a
 * distance from its top edge: the status bar's height plus AR_TAG_GAP_BELOW_STATUS_BAR_PX. Read
 * when called (the inset is only known at runtime, and changes with rotation), never fixed.
 */
export const AR_TAG_TOP_SAFE_MARGIN_PX = () => readTopCoverPx() + AR_TAG_GAP_BELOW_STATUS_BAR_PX;
