import { describe, it, expect } from 'vitest';
import { projectMomentum, shouldDismissSheet, SHEET_DISMISS_FRACTION, modalCard } from '../src/utils/motion.js';

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
