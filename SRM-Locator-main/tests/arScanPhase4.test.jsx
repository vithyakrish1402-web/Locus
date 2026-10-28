// @vitest-environment jsdom
//
// AR Scan fixes, through the real ARCompass:
//  - closing AR Scan stops the camera, whichever screen it was on, and a camera that arrives
//    after it closed is stopped at once (the phone's camera dot stayed on);
//  - while the fix is rougher than AR_MIN_ACCURACY_M it says so, with no distance or arrow;
//  - the arrow follows where the camera points, also while walking (it took the walking
//    direction, up to 90 deg off when the phone was turned sideways mid-step).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ animate, children, className }) => (
      <div data-testid="ar-arrow" data-rotate={animate?.rotate} className={className}>{children}</div>
    ),
  },
}));

const { default: ARCompass } = await import('../src/ARCompass.jsx');
const { AR_READOUT } = await import('../src/copy/arScan.js');
const { magneticDeclination } = await import('../src/utils/declination.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
const north = (m) => ({ lat: HERE.lat + m / 111320, lng: HERE.lng });
const TARGET = { name: 'TECH_PARK', ...north(300) };

let geoCallbacks;
let track;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  geoCallbacks = null;
  track = { stop: vi.fn() };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: vi.fn((ok) => { geoCallbacks = ok; return 7; }), clearWatch: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete navigator.geolocation;
  delete navigator.mediaDevices;
});

const fix = (p, accuracy) => act(() => geoCallbacks({ coords: { latitude: p.lat, longitude: p.lng, accuracy }, timestamp: Date.now() }));
const compass = (heading, ms = 16) => {
  act(() => vi.advanceTimersByTime(ms));
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha: (360 - heading) % 360 });
  act(() => window.dispatchEvent(event));
};
const rotation = () => {
  const r = ((Number(screen.getByTestId('ar-arrow').getAttribute('data-rotate')) % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
};
const openAr = async (props = {}) => {
  const view = render(<ARCompass target={TARGET} liveLocation={HERE} onClose={() => {}} {...props} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
  return view;
};

describe('the camera', () => {
  it('stops when AR Scan closes', async () => {
    const view = await openAr();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it('is stopped at once when it arrives after AR Scan closed', async () => {
    let give;
    navigator.mediaDevices.getUserMedia = vi.fn(() => new Promise((resolve) => { give = resolve; }));
    const view = await openAr();
    view.unmount();
    await act(async () => give({ getTracks: () => [track] }));
    expect(track.stop).toHaveBeenCalled();
  });
});

describe('a rough fix', () => {
  it('says the location is rough, with no distance, way or arrow, until it settles', async () => {
    await openAr();
    fix(HERE, 5);
    expect(screen.getByTestId('ar-readout-distance')).toBeTruthy();
    fix(north(10), 80);
    expect(screen.getByTestId('ar-readout-rough').textContent).toBe(AR_READOUT.lowAccuracy);
    expect(screen.queryByTestId('ar-readout-distance')).toBeNull();
    expect(screen.queryByTestId('ar-readout-way')).toBeNull();
    expect(screen.queryByTestId('ar-arrow')).toBeNull();
    fix(north(2), 6);
    expect(screen.queryByTestId('ar-readout-rough')).toBeNull();
    expect(screen.getByTestId('ar-readout-distance')).toBeTruthy();
  });
});

describe('the arrow while walking', () => {
  it('follows where the camera points, not the way you walk', async () => {
    const east = { name: 'E', lat: HERE.lat, lng: 80.0540 };
    await openAr({ target: east, speedMps: 1.5 });
    // Walking north, phone turned to face east (the target).
    for (let i = 0; i < 10; i++) {
      fix(north(i * 1.5), 4);
      for (let j = 0; j < 8; j++) compass(90, 120);
    }
    const decl = magneticDeclination(12.82, 80.04);
    // Straight ahead, give or take the few metres walked (the walking direction is 90 deg off).
    expect(Math.abs(rotation() + decl)).toBeLessThan(3);
  });
});
