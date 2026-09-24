// One place for how LOCUS moves, so every surface feels like the same object.
//
// Springs, not fixed-duration curves, for anything a person touches: a spring starts from
// wherever the element is right now and carries its current velocity, so an animation
// that is interrupted mid-flight (a sheet grabbed while closing) never jumps. Framer
// Motion's `visualDuration` + `bounce` map onto Apple's response + damping.

/** Sheets and drawers: a little give, because they are thrown by a finger. */
export const SHEET_SPRING = { type: 'spring', visualDuration: 0.34, bounce: 0.14 };

/** Panels and modals that appear on a tap: settle without overshoot. */
export const PANEL_SPRING = { type: 'spring', visualDuration: 0.3, bounce: 0 };

/** Small indicators (the tab highlight): quick, and just enough bounce to feel alive. */
export const INDICATOR_SPRING = { type: 'spring', visualDuration: 0.28, bounce: 0.22 };

/**
 * How far a release at `velocity` (px/s) would travel before coming to rest, using the
 * exponential deceleration of native scrolling (Apple's "Designing Fluid Interfaces"
 * projection). Deciding "close or snap back" from this projected point, rather than from
 * where the finger lifted, is what makes a short flick feel like a throw.
 *
 * @param {number} velocity px/s
 * @param {number} [decelerationRate] per-millisecond rate; 0.998 matches normal scrolling
 */
export function projectMomentum(velocity, decelerationRate = 0.998) {
  if (!Number.isFinite(velocity)) return 0;
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Every modal's dimmed backdrop: a quick fade, never a spring (it has no position).
 * Spread onto the backdrop's motion.div.
 */
export const modalBackdrop = () => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: 'easeOut' },
});

/**
 * Every modal's card "materializes": it rises a little, sharpens out of a slight blur and
 * settles on one spring, then leaves along the same path it came in by. With reduced
 * motion it only cross-fades.
 * @param {boolean} reduceMotion
 */
export const modalCard = (reduceMotion) =>
  reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, y: 24, scale: 0.96, filter: 'blur(6px)' },
        animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
        exit: { opacity: 0, y: 24, scale: 0.96, filter: 'blur(6px)' },
        transition: PANEL_SPRING,
      };

/** Past this fraction of its height (after projection), a released sheet closes. */
export const SHEET_DISMISS_FRACTION = 0.3;

/**
 * Whether a sheet released after being dragged down by `offsetY` px at `velocityY` px/s
 * should close. Decided from where the throw would come to rest, so a quick short flick
 * closes and a long drag that stops before letting go snaps back. A flick upwards (negative
 * velocity) projects back up and keeps it open.
 */
export function shouldDismissSheet(offsetY, velocityY, height) {
  if (!Number.isFinite(offsetY) || !(height > 0)) return false;
  return offsetY + projectMomentum(velocityY) > height * SHEET_DISMISS_FRACTION;
}
