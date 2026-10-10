// @vitest-environment jsdom
//
// AR Scan's readout (redesign AR Scan batch, piece 8): how far, large; which way, as a
// clock face while the compass is steady and in compass words otherwise; and "about N min
// on foot" only along a real route. Without one, distance and direction only.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ animate, children, className }) => (
      <div data-testid="ar-arrow" data-rotate={animate?.rotate} className={className}>{children}</div>
    ),
  },
}));

const { default: ARCompass } = await import('../src/ARCompass.jsx');
const { CALIBRATION_SHOW_AFTER_MS } = await import('../src/utils/arHeading.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
const north = (m) => ({ lat: HERE.lat + m / 111320, lng: HERE.lng });
const TARGET = { name: 'TECH PARK', ...north(300) };

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// One compass reading `ms` after the last: the phone facing `heading` (magnetic).
const compass = (heading, ms = 16) => {
  act(() => vi.advanceTimersByTime(ms));
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha: (360 - heading) % 360 });
  act(() => window.dispatchEvent(event));
};
const openAr = async (props = {}) => {
  render(<ARCompass target={TARGET} liveLocation={HERE} onClose={() => {}} {...props} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
};
const readout = () => screen.getByTestId('ar-readout');
const way = () => screen.queryByTestId('ar-readout-way')?.textContent ?? '';

describe('the readout', () => {
  it('shows the distance large, in plain units', async () => {
    await openAr();
    const distance = screen.getByTestId('ar-readout-distance');
    expect(distance.textContent).toBe('300 m');
    expect(distance.className).toContain('text-[40px]');
  });

  it('without a compass reading: compass words, which need no compass', async () => {
    await openAr();
    expect(way()).toBe('to the north');
  });

  it('with a steady compass: a clock face', async () => {
    await openAr();
    for (let i = 0; i < 30; i++) compass(0);
    expect(way()).toBe('straight ahead');
    for (let i = 0; i < 60; i++) compass(270);
    expect(way()).toBe('3 o’clock');
  });

  it('while the compass needs calibrating: compass words again, not a clock it cannot trust', async () => {
    await openAr();
    for (let i = 0; i < 250 && screen.getByTestId('ar-calibration-banner').dataset.visible !== 'true'; i++) {
      compass(90 + (i % 2 ? 20 : -20));
    }
    expect(screen.getByTestId('ar-calibration-banner').dataset.visible).toBe('true');
    expect(CALIBRATION_SHOW_AFTER_MS).toBeGreaterThan(0);
    expect(way()).toBe('to the north');
  });

  it('no real route: distance and direction only, no walking time', async () => {
    await openAr({ routePath: null });
    expect(readout().textContent).not.toMatch(/min on foot/);
  });

  it('along a real route: about N min on foot, from what is left of the route', async () => {
    // A dog-leg 300 m north then 300 m east: 600 m of walking for a 300 m-ish straight line.
    const east = (p, m) => ({ lat: p.lat, lng: p.lng + m / (111320 * Math.cos((p.lat * Math.PI) / 180)) });
    const corner = north(300);
    const end = east(corner, 300);
    await openAr({ target: { name: 'TECH PARK', ...end }, routePath: [HERE, corner, end] });
    // 600 m at 1.4 m/s is about 7 min (not the 5 min the straight line would give).
    expect(way()).toBe('to the north-east · about 7 min on foot');
  });

  it('no fix yet: says it is waiting, no made-up distance', async () => {
    await openAr({ liveLocation: null });
    expect(screen.queryByTestId('ar-readout-distance')).toBeNull();
    expect(within(readout()).getByText('Waiting for your location')).toBeTruthy();
  });

  it('sits in the HUD that keeps clear of the Emergency button, and is never red', async () => {
    await openAr();
    expect(screen.getByTestId('ar-ui').contains(readout())).toBe(true);
    expect(readout().outerHTML).not.toMatch(/red-|#EF4444|font-dot|PROXIMITY|TARGET_LOCK/);
  });
});
