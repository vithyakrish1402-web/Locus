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


// The redesign's timings (docs/redesign/handoff.md, "Motion"), in seconds as framer-motion
// takes them. The same values are CSS variables in src/theme/tokens.css (--duration-*).
// Everything here moves only transform and opacity.

/** Curves: standard for things that move on screen, enter for arrivals, exit for leaving. */
export const EASE = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0, 1],
  exit: [0.3, 0, 1, 1],
};

const FADE_S = 0.2;
const SCREEN_S = 0.24;
const SCREEN_SLIDE_PX = 24;
const EXIT_S = 0.18;
const LIST_S = 0.24;
const LIST_STAGGER_S = 0.04;
const LIST_STAGGERED_ITEMS = 5;
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
