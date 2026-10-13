// One place for how LOCUS moves, so every surface feels like the same object.
//
// Springs, not fixed-duration curves, for anything a person touches: a spring starts from
// wherever the element is right now and carries its current velocity, so an animation
// that is interrupted mid-flight (a sheet grabbed while closing) never jumps. Framer
// Motion's `visualDuration` + `bounce` map onto Apple's response + damping.

/** Sheets and drawers: smooth and natural with minimal overshoot */
export const SHEET_SPRING = { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 };

/** Panels and modals that appear on a tap: fluid and crisp, settling without oscillation. */
export const PANEL_SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 };

/** Small indicators (the tab highlight, segment thumb): quick, fluid, and responsive. */
export const INDICATOR_SPRING = { type: 'spring', stiffness: 500, damping: 38, mass: 0.7 };

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
 * Every modal's dimmed backdrop: a quick, fluid fade.
 * Spread onto the backdrop's motion.div.
 */
export const modalBackdrop = () => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
});

/**
 * Modal card entrance: rises smoothly with fluid scale and settles naturally.
 * With reduced motion it only fades.
 * @param {boolean} reduceMotion
 */
export const modalCard = (reduceMotion) =>
  reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: REDUCED_MOTION_S } }
    : {
        initial: { opacity: 0, y: 20, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 16, scale: 0.98 },
        transition: PANEL_SPRING,
      };

// Fluid timings in seconds as framer-motion takes them.
// Optimized for fluid, immediate response without delay or layout jumps.

/** Fluid curves: standard for micro-interactions, enter for arrivals, exit for dismissals. */
export const EASE = {
  fluid: [0.22, 1, 0.36, 1],
  standard: [0.22, 1, 0.36, 1],
  enter: [0.16, 1, 0.3, 1],
  exit: [0.3, 0, 0.8, 0.15],
};

const FADE_S = 0.22;
const SCREEN_S = 0.26;
const SCREEN_SLIDE_PX = 20;
const EXIT_S = 0.18;
const LIST_S = 0.24;
const LIST_STAGGER_S = 0.035;
const LIST_STAGGERED_ITEMS = 6;
/** Reduced motion: slides become fades this long, and sheets settle this fast. */
export const REDUCED_MOTION_S = 0.15;

/** A plain fade in and out. */
export const fade = () => ({
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: FADE_S, ease: EASE.standard } },
  exit: { opacity: 0, transition: { duration: EXIT_S, ease: EASE.exit } },
});

/**
 * A full screen arriving: slides 24 px and fades; going forward it comes from the right,
 * going back from the left. With reduced motion, a short fade.
 * @param {'forward'|'back'} direction
 * @param {boolean} reduceMotion
 */
export const screenTransition = (direction, reduceMotion) => {
  if (reduceMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: REDUCED_MOTION_S } },
      exit: { opacity: 0, transition: { duration: REDUCED_MOTION_S } },
    };
  }
  const from = direction === 'back' ? -SCREEN_SLIDE_PX : SCREEN_SLIDE_PX;
  return {
    initial: { opacity: 0, x: from },
    animate: { opacity: 1, x: 0, transition: { duration: SCREEN_S, ease: EASE.enter } },
    exit: { opacity: 0, x: -from, transition: { duration: EXIT_S, ease: EASE.exit } },
  };
};

/**
 * A list row's first appearance: the first five arrive 40 ms apart, the rest with the
 * fifth. Spread onto the row only while the list first shows; later rows just appear.
 * With reduced motion, no stagger and no slide.
 * @param {number} index
 * @param {boolean} reduceMotion
 */
export const listItem = (index, reduceMotion) => (reduceMotion
  ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: REDUCED_MOTION_S } } }
  : {
      initial: { opacity: 0, y: 8 },
      animate: {
        opacity: 1,
        y: 0,
        transition: { duration: LIST_S, ease: EASE.enter, delay: Math.min(Math.max(index, 0), LIST_STAGGERED_ITEMS - 1) * LIST_STAGGER_S },
      },
    });

/**
 * How a sheet settles once let go: on SHEET_SPRING, or with reduced motion a short ease
 * (it still follows the finger while dragged).
 * @param {boolean} reduceMotion
 */
export const sheetSettle = (reduceMotion) => (reduceMotion ? { duration: REDUCED_MOTION_S, ease: EASE.standard } : SHEET_SPRING);

/**
 * What a sheet does when the finger lets go after dragging it down by `offsetY` px at
 * `velocityY` px/s: close (decided by shouldDismissSheet), or settle back open on
 * sheetSettle's transition.
 * @returns {{ close: true } | { close: false, transition: object }}
 */
export function releaseSheet(offsetY, velocityY, height, reduceMotion) {
  return shouldDismissSheet(offsetY, velocityY, height)
    ? { close: true }
    : { close: false, transition: sheetSettle(reduceMotion) };
}

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
