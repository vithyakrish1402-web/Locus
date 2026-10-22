// The group panel's three heights and closed (src/utils/panelHeights.js).
import { describe, it, expect } from 'vitest';
import { panelStops, snapPanel, sheetBottomPadding } from '../src/utils/panelHeights.js';

// A 412 × 892 phone: the panel runs from under the top bar (y 76) to the tab bar (64 px).
const PHONE = { viewport: 892, panelHeight: 892 - 64 - 76, peekHeight: 240 };
const stops = panelStops(PHONE);

describe('where each height rests', () => {
  it('full: not moved', () => {
    expect(stops.full).toBe(0);
  });

  it('half: covers the lower 55 % of the screen', () => {
    const top = 892 - 64 - PHONE.panelHeight + stops.half;
    expect(top).toBeCloseTo(892 * 0.45, 0);
  });

  it('peek: shows exactly its peek height', () => {
    expect(PHONE.panelHeight - stops.peek).toBe(240);
  });

  it('closed: tucked away by its whole height', () => {
    expect(stops.closed).toBe(PHONE.panelHeight);
  });

  it('in order, top to bottom', () => {
    expect(stops.full).toBeLessThan(stops.half);
    expect(stops.half).toBeLessThan(stops.peek);
    expect(stops.peek).toBeLessThan(stops.closed);
  });

  it('never outside the panel, on a short screen', () => {
    const short = panelStops({ viewport: 500, panelHeight: 360, peekHeight: 400 });
    Object.values(short).forEach((y) => { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(360); });
  });
});

describe('where a drag comes to rest', () => {
  it('a slow let-go settles at the nearest height', () => {
    expect(snapPanel(stops.half + 20, 0, stops)).toBe('half');
    expect(snapPanel(stops.peek - 15, 0, stops)).toBe('peek');
    expect(snapPanel(10, 0, stops)).toBe('full');
  });

  it('a strong flick down from half carries on past peek and closes', () => {
    expect(snapPanel(stops.half + 30, 5000, stops)).toBe('closed');
  });

  it('a strong flick up from peek opens it right up', () => {
    expect(snapPanel(stops.peek - 30, -5000, stops)).toBe('full');
  });

  it('a gentle flick moves one height', () => {
    expect(snapPanel(stops.half + 10, 1200, stops)).toBe('peek');
  });

  it('an ordinary let-go, still moving a little, rests at the nearest height', () => {
    expect(snapPanel(stops.half + 150, 500, stops)).toBe('peek');
    expect(snapPanel(stops.half + 40, 500, stops)).toBe('half');
  });
});

describe('the panel standing on the real tab bar', () => {
  // The same phone, with its 80 px bar plus a 34 px gesture inset (114), not the old 64.
  const input = { viewport: 892, panelHeight: 892 - 114 - 76, peekHeight: 240, tabBar: 114 };
  const real = panelStops(input);

  it('half still covers the lower 55 % of the screen', () => {
    const top = 892 - 114 - input.panelHeight + real.half;
    expect(top).toBeCloseTo(892 * 0.45, 0);
  });

  it('peek still shows exactly its peek height', () => {
    expect(input.panelHeight - real.peek).toBe(240);
  });
});

describe('the bottom padding of the list', () => {
  it('is one tab bar plus how far the panel is slid down', () => {
    expect(sheetBottomPadding(0)).toBe('calc(var(--tab-bar-height) + 0px)');
    expect(sheetBottomPadding(272.4)).toBe('calc(var(--tab-bar-height) + 272px)');
  });

  it('never goes negative (a rubber-banded panel)', () => {
    expect(sheetBottomPadding(-12)).toBe('calc(var(--tab-bar-height) + 0px)');
  });
});
