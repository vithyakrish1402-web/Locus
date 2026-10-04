// @vitest-environment jsdom
//
// The Landmark Anchor Engine through the real ARCompass: one-tap ALIGN fixes a consistent
// compass error (and is refused when it can't be trusted), the correction lasts the app
// session until RESET, and the destination is never tagged twice.
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
const { notify } = await import('../src/utils/notify.js');
const { magneticDeclination } = await import('../src/utils/declination.js');
const { calculateBearing } = await import('../src/utils/geoMath.js');
const { ALIGNMENT_STORAGE_KEY } = await import('../src/utils/landmarkAnchorEngine.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
const at = (bearing, meters) => {
  const r = (bearing * Math.PI) / 180;
  return {
    lat: HERE.lat + (meters * Math.cos(r)) / 111320,
    lng: HERE.lng + (meters * Math.sin(r)) / (111320 * Math.cos((HERE.lat * Math.PI) / 180)),
  };
};
const TOWER = { id: 'tw', name: 'TOWER', ...at(20, 220) };
const TARGET = { name: 'RALLY_ALPHA', ...at(-60, 300) };
const DECL = magneticDeclination(12.82, 80.04);
const towerBearing = calculateBearing(HERE.lat, HERE.lng, TOWER.lat, TOWER.lng);

let geoCallback;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  window.sessionStorage.clear();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: vi.fn((ok) => { geoCallback = ok; return 1; }), clearWatch: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete navigator.geolocation;
});

const fix = (accuracy) => act(() => geoCallback({ coords: { latitude: HERE.lat, longitude: HERE.lng, accuracy }, timestamp: Date.now() }));
// A compass reading of true heading `trueHeading` plus the compass's own `errorDeg`, the
// phone held upright as for AR (beta 90: the camera looks out level).
const compass = (trueHeading, errorDeg = 0) => {
  act(() => vi.advanceTimersByTime(120));
  const magnetic = trueHeading + errorDeg - DECL;
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha: ((360 - magnetic) % 360 + 360) % 360, beta: 90, gamma: 0 });
  act(() => window.dispatchEvent(event));
};
const settle = () => act(() => vi.advanceTimersByTime(1500));
const tagEl = (name) => screen.getAllByTestId('ar-tag').find((el) => el.textContent.includes(name));
const tagLeft = (name) => parseFloat(tagEl(name).style.left);
const tagTop = (name) => parseFloat(tagEl(name).style.top);

const openAr = async (props = {}) => {
  const view = render(<ARCompass target={TARGET} liveLocation={HERE} buildings={[TOWER]} onClose={() => {}} {...props} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  return view;
};

describe('one-tap ALIGN', () => {
  it('fixes a consistent sideways compass error: the centred building’s tag lands on the centre', async () => {
    const success = vi.spyOn(notify, 'success').mockImplementation(() => {});
    await openAr();
    fix(5);
    // The user points straight at the tower; the compass says 6 deg further round.
    for (let i = 0; i < 4; i++) compass(towerBearing, 6);
    settle();
    expect(tagLeft('TOWER')).toBeLessThan(45); // drawn off to the left of the real tower
    expect(screen.queryByRole('button', { name: 'RESET ALIGN' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ALIGN' }));
    for (let i = 0; i < 4; i++) compass(towerBearing, 6); // same error, now corrected
    settle();
    expect(tagLeft('TOWER')).toBeCloseTo(50, 0);
    // The pitch correction too: the user centred the tower, so its tag's point is on the
    // centre row as well (it was a little above: the anchor is 60% up the building).
    expect(tagTop('TOWER')).toBeCloseTo(50, 0);
    expect(success).toHaveBeenCalledWith(expect.stringContaining('ALIGNED ON TOWER: HEADING -6.0°'));
    expect(screen.getByRole('button', { name: 'RESET ALIGN' }).textContent).toBe('RESET -6.0°');
    expect(JSON.parse(window.sessionStorage.getItem(ALIGNMENT_STORAGE_KEY)).headingOffsetDeg).toBeCloseTo(-6, 0);
  });

  it('keeps the correction for the session, and RESET takes it off', async () => {
    vi.spyOn(notify, 'success').mockImplementation(() => {});
    const first = await openAr();
    fix(5);
    for (let i = 0; i < 4; i++) compass(towerBearing, 6);
    settle();
    fireEvent.click(screen.getByRole('button', { name: 'ALIGN' }));
    first.unmount();

    await openAr(); // AR Scan opened again later in the same app session
    fix(5);
    for (let i = 0; i < 4; i++) compass(towerBearing, 6);
    settle();
    expect(tagLeft('TOWER')).toBeCloseTo(50, 0);

    fireEvent.click(screen.getByRole('button', { name: 'RESET ALIGN' }));
    for (let i = 0; i < 4; i++) compass(towerBearing, 6);
    settle();
    expect(tagLeft('TOWER')).toBeLessThan(45);
    expect(screen.queryByRole('button', { name: 'RESET ALIGN' })).toBeNull();
    expect(window.sessionStorage.getItem(ALIGNMENT_STORAGE_KEY)).toBeNull();
  });

  it('refuses with a rough GPS fix, and changes nothing', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => {});
    await openAr();
    fix(25);
    for (let i = 0; i < 4; i++) compass(towerBearing, 6);
    settle();
    const before = tagLeft('TOWER');
    fireEvent.click(screen.getByRole('button', { name: 'ALIGN' }));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('GPS fix too rough'));
    settle();
    expect(tagLeft('TOWER')).toBe(before);
    expect(screen.queryByRole('button', { name: 'RESET ALIGN' })).toBeNull();
  });

  it('refuses while walking, when the heading comes from GPS rather than the compass', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => {});
    await openAr({ speedMps: 2 });
    fix(5);
    for (let i = 0; i < 4; i++) compass(towerBearing, 6);
    fireEvent.click(screen.getByRole('button', { name: 'ALIGN' }));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('stand still'));
  });

  it('refuses with no building in view', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => {});
    await openAr();
    fix(5);
    for (let i = 0; i < 4; i++) compass(towerBearing + 150); // facing away
    settle();
    fireEvent.click(screen.getByRole('button', { name: 'ALIGN' }));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('centre a building'));
  });
});

describe('landmark list', () => {
  it('gives a squad member who is the destination one tag, not two', async () => {
    const m = { id: 's1', uid: 'u1', name: 'BRAVO', hasFix: true, ...at(0, 80) };
    const target = { name: 'BRAVO', memberUid: 'u1', ...at(0, 80) };
    await openAr({ target, squadMembers: [m, { id: 's2', uid: 'u2', name: 'CHARLIE', hasFix: true, ...at(5, 120) }] });
    for (let i = 0; i < 3; i++) compass(0);
    const tags = screen.getAllByTestId('ar-tag');
    expect(tags.filter((t) => t.textContent.includes('BRAVO')).map((t) => t.dataset.variant)).toEqual(['target']);
    expect(tags.some((t) => t.textContent.includes('CHARLIE'))).toBe(true);
  });

  it('anchors a destination that is a building like that building, and lets ALIGN use it', async () => {
    vi.spyOn(notify, 'success').mockImplementation(() => {});
    await openAr({ target: { name: 'TOWER', lat: TOWER.lat, lng: TOWER.lng } });
    fix(5);
    for (let i = 0; i < 4; i++) compass(towerBearing, 6);
    settle();
    expect(screen.getAllByTestId('ar-tag').filter((t) => t.textContent.includes('TOWER')).map((t) => t.dataset.variant)).toEqual(['target']);
    // Up the building, not on the ground: above the centre row with the phone level (a
    // ground point would sit below it, the camera being 1.4 m up).
    expect(tagTop('TOWER')).toBeLessThan(49);
    fireEvent.click(screen.getByRole('button', { name: 'ALIGN' }));
    for (let i = 0; i < 4; i++) compass(towerBearing, 6);
    settle();
    expect(tagLeft('TOWER')).toBeCloseTo(50, 0);
  });
});
