import { describe, it, expect } from 'vitest';
import {
  projectMomentum, shouldDismissSheet, SHEET_DISMISS_FRACTION, modalCard, fade, screenTransition, listItem,
  sheetSettle, SHEET_SPRING, EASE, REDUCED_MOTION_S,
} from '../src/utils/motion.js';

describe('projectMomentum', () => {
  it("matches Apple's scroll-deceleration projection", () => {
    // (v / 1000) * d / (1 - d) with d = 0.998: 1000 px/s travels ~499 px before resting.
    expect(projectMomentum(1000)).toBeCloseTo(499, 0);
    expect(projectMomentum(0)).toBe(0);
    expect(projectMomentum(-500)).toBeCloseTo(-249.5, 1);
  });

  it('is nothing for a missing or broken velocity', () => {
    expect(projectMomentum(undefined)).toBe(0);
    expect(projectMomentum(NaN)).toBe(0);
    expect(projectMomentum(Infinity)).toBe(0);
  });
});

describe('shouldDismissSheet', () => {
  const height = 700; // closes past 30% = 210 px, after projection

  it('closes on a short, fast flick', () => {
    // 60 px of travel, but thrown at 800 px/s: it would come to rest ~460 px down.
    expect(shouldDismissSheet(60, 800, height)).toBe(true);
  });

  it('snaps back from a long drag that stopped before letting go', () => {
    expect(shouldDismissSheet(180, 0, height)).toBe(false);
  });

  it('closes a slow drag that went most of the way', () => {
    expect(shouldDismissSheet(400, 0, height)).toBe(true);
  });

  it('stays open when flicked back up, even from well down', () => {
    expect(shouldDismissSheet(300, -900, height)).toBe(false);
  });

  it('uses the stated threshold', () => {
    expect(SHEET_DISMISS_FRACTION).toBe(0.3);
    expect(shouldDismissSheet(height * 0.3 + 1, 0, height)).toBe(true);
    expect(shouldDismissSheet(height * 0.3 - 1, 0, height)).toBe(false);
  });

  it('never closes on nonsense input', () => {
    expect(shouldDismissSheet(NaN, 0, height)).toBe(false);
    expect(shouldDismissSheet(500, 0, 0)).toBe(false);
    expect(shouldDismissSheet(500, 0, undefined)).toBe(false);
  });
});

describe('modalCard', () => {
  it('enters and leaves along the same path', () => {
    const card = modalCard(false);
    expect(card.exit).toEqual(card.initial);
  });

  it('only cross-fades under reduced motion', () => {
    const card = modalCard(true);
    expect(Object.keys(card.initial)).toEqual(['opacity']);
    expect(Object.keys(card.exit)).toEqual(['opacity']);
  });
});

// The redesign's rule: animate only transform and opacity (framer-motion's x, y, scale and
// rotate are transforms).
const TRANSFORM_OR_OPACITY = new Set(['opacity', 'x', 'y', 'scale', 'rotate', 'transition']);
const onlyTransformAndOpacity = (states) => states.forEach((state) => {
  Object.keys(state ?? {}).forEach((key) => expect(TRANSFORM_OR_OPACITY.has(key), `animates ${key}`).toBe(true));
});
const statesOf = (preset) => [preset.initial, preset.animate, preset.exit];

describe('motion presets move only transform and opacity', () => {
  it.each([false, true])('reduced motion %s', (reduce) => {
    onlyTransformAndOpacity(statesOf(modalCard(reduce)));
    onlyTransformAndOpacity(statesOf(fade()));
    onlyTransformAndOpacity(statesOf(screenTransition('forward', reduce)));
    onlyTransformAndOpacity(statesOf(screenTransition('back', reduce)));
    onlyTransformAndOpacity(statesOf(listItem(0, reduce)));
  });
});

describe('screenTransition', () => {
  it('slides 24 px: forward from the right, back from the left, leaving the other way', () => {
    expect(screenTransition('forward', false).initial.x).toBe(24);
    expect(screenTransition('forward', false).exit.x).toBe(-24);
    expect(screenTransition('back', false).initial.x).toBe(-24);
    expect(screenTransition('back', false).exit.x).toBe(24);
    expect(screenTransition('forward', false).animate.transition.duration).toBe(0.24);
  });

  it('is a 150 ms fade under reduced motion', () => {
    const t = screenTransition('forward', true);
    expect(t.initial).toEqual({ opacity: 0 });
    expect(t.animate.transition.duration).toBe(REDUCED_MOTION_S);
    expect(REDUCED_MOTION_S).toBe(0.15);
  });
});

describe('listItem', () => {
  it('staggers the first five by 40 ms, and the rest arrive with the fifth', () => {
    const delay = (i) => listItem(i, false).animate.transition.delay;
    expect([0, 1, 2, 3, 4].map(delay)).toEqual([0, 0.04, 0.08, 0.12, 0.16]);
    expect(delay(9)).toBe(0.16);
  });

  it('has no stagger under reduced motion', () => {
    expect(listItem(4, true).animate.transition.delay).toBeUndefined();
  });
});

describe('sheetSettle', () => {
  it('settles on the sheet spring, or a 150 ms ease under reduced motion', () => {
    expect(sheetSettle(false)).toBe(SHEET_SPRING);
    expect(sheetSettle(true)).toEqual({ duration: 0.15, ease: EASE.standard });
  });
});
