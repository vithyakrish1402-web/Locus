// @vitest-environment jsdom
//
// AR Scan's accuracy work, through the real ARCompass: the calibration banner shows only
// while the compass is unreliable (and doesn't flicker), the debug overlay hides behind a
// long-press, AR Scan runs its own accuracy-gated GPS watch with a distance dead-band, the
// fused orientation sensor is preferred where there is one, and things off-screen get a
// tag on the edge.
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
const { magneticDeclination } = await import('../src/utils/declination.js');
const { CALIBRATION_SHOW_AFTER_MS } = await import('../src/utils/arHeading.js');
const { calculateDistanceMeters } = await import('../src/utils/geoMath.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
const north = (m) => ({ lat: HERE.lat + m / 111320, lng: HERE.lng });
const TARGET = { name: 'TECH_PARK', ...north(300) };

let geoCallbacks;
beforeEach(() => {
  // Animation frames and performance.now too: the tag layer runs the Landmark Anchor
  // Engine on them.
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  geoCallbacks = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete navigator.geolocation;
  delete window.AbsoluteOrientationSensor;
});

const installGeolocation = () => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok) => { geoCallbacks = ok; return 7; }),
      clearWatch: vi.fn(),
    },
  });
};
const fix = (p, accuracy) => act(() => geoCallbacks({ coords: { latitude: p.lat, longitude: p.lng, accuracy }, timestamp: Date.now() }));

// One compass reading `ms` after the last.
const compass = (heading, ms = 16) => {
  act(() => vi.advanceTimersByTime(ms));
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha: (360 - heading) % 360 });
  act(() => window.dispatchEvent(event));
};
const banner = () => screen.getByTestId('ar-calibration-banner');
const proximity = () => screen.getByText('PROXIMITY').nextSibling.textContent;
const metresTo = (p) => `${calculateDistanceMeters(p.lat, p.lng, TARGET.lat, TARGET.lng)}M`;
const rotation = () => {
  const r = ((Number(screen.getByTestId('ar-arrow').getAttribute('data-rotate')) % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
};

const openAr = async (props = {}) => {
  const view = render(<ARCompass target={TARGET} liveLocation={HERE} onClose={() => {}} {...props} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  return view;
};

describe('the calibration banner', () => {
  it('is hidden while the compass is steady', async () => {
    await openAr();
    for (let i = 0; i < 200; i++) compass(10 + (i % 2 ? 0.2 : -0.2));
    expect(banner().dataset.visible).toBe('false');
    expect(banner().getAttribute('aria-hidden')).toBe('true');
    expect(banner().className).toContain('opacity-0');
    expect(banner().textContent).toContain('CALIBRATE SENSOR: PERFORM FIGURE-8 MOTION');
  });

  it('shows after the compass has been erratic for 2 s, not at the first wobble', async () => {
    await openAr();
    let shownAt = null;
    for (let i = 0; i < 250 && shownAt === null; i++) {
      compass(90 + (i % 2 ? 20 : -20));
      if (banner().dataset.visible === 'true') shownAt = (i + 1) * 16;
    }
    expect(shownAt).toBeGreaterThanOrEqual(CALIBRATION_SHOW_AFTER_MS);
    expect(banner().className).toContain('opacity-100');
    expect(banner().getAttribute('aria-hidden')).toBe('false');
  });

  it('hides again once the compass has settled for a while, and stays hidden', async () => {
    await openAr();
    for (let i = 0; i < 250; i++) compass(90 + (i % 2 ? 20 : -20));
    expect(banner().dataset.visible).toBe('true');
    const seen = [];
    for (let i = 0; i < 300; i++) {
      compass(90 + (i % 2 ? 0.2 : -0.2));
      seen.push(banner().dataset.visible);
    }
    const firstHidden = seen.indexOf('false');
    expect(firstHidden * 16).toBeGreaterThanOrEqual(2000);
    expect(seen.slice(firstHidden).every((v) => v === 'false')).toBe(true);
  });
});

describe('the debug overlay', () => {
  it('is hidden until a long-press on the title, and a second long-press hides it', async () => {
    installGeolocation();
    await openAr();
    compass(30);
    fix(HERE, 6);
    expect(screen.queryByTestId('ar-debug-overlay')).toBeNull();
    const title = screen.getByText('AR_TRACKER');
    // A tap doesn't open it.
    fireEvent.pointerDown(title);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(title);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('ar-debug-overlay')).toBeNull();

    fireEvent.pointerDown(title);
    act(() => vi.advanceTimersByTime(750));
    fireEvent.pointerUp(title);
    act(() => vi.advanceTimersByTime(300)); // one refresh
    const overlay = screen.getByTestId('ar-debug-overlay');
    const decl = magneticDeclination(12.82, 80.04);
    expect(overlay.textContent).toContain(`DECL     ${decl.toFixed(2)}°`);
    expect(overlay.textContent).toContain('RAW_HDG  30.0° MAG');
    expect(overlay.textContent).toContain(`TRUE_HDG ${(30 + decl).toFixed(1)}°`);
    expect(overlay.textContent).toContain('SENSOR   orientation-event');
    expect(overlay.textContent).toContain('SNS_ACC  N/A');
    expect(overlay.textContent).toContain('GPS_ACC  6 M');
    expect(overlay.textContent).toMatch(/FOV_H\/V {2}\d+\.\d° \/ \d+\.\d°/);
    expect(overlay.textContent).toMatch(/PITCH {4}-?\d+\.\d° {2}ROLL -?\d+\.\d°/);
    expect(overlay.textContent).toContain('ALIGN    HDG +0.0°  PITCH +0.0°');
    expect(overlay.textContent).toMatch(/TECH_PARK\s+\d+,\d+/); // the destination's screen position

    fireEvent.pointerDown(title);
    act(() => vi.advanceTimersByTime(750));
    expect(screen.queryByTestId('ar-debug-overlay')).toBeNull();
  });
});

describe('AR Scan’s own GPS', () => {
  it('measures from its own fixes, ignores vague ones, and holds the distance through small changes', async () => {
    installGeolocation();
    await openAr({ liveLocation: north(-500) }); // the shared fix is far off and stale
    expect(proximity()).toBe(metresTo(north(-500)));
    fix(HERE, 5);
    const fromHere = metresTo(HERE);
    expect(proximity()).toBe(fromHere);
    fix(north(150), 60); // too vague: ignored
    expect(proximity()).toBe(fromHere);
    fix(north(1), 5); // the filter moves under a metre: held
    expect(proximity()).toBe(fromHere);
    for (let i = 0; i < 10; i++) {
      act(() => vi.advanceTimersByTime(1000));
      fix(north(10), 4); // walked 10 m: shown
    }
    expect(Number(proximity().replace('M', ''))).toBeLessThanOrEqual(Number(fromHere.replace('M', '')) - 8);
    expect(navigator.geolocation.watchPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it('stops its watch when AR Scan closes', async () => {
    installGeolocation();
    const view = await openAr();
    view.unmount();
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(7);
  });

  it('uses the shared fix where there is no geolocation', async () => {
    await openAr({ liveLocation: north(-100) });
    expect(proximity()).toBe(metresTo(north(-100)));
  });
});

describe('the fused orientation sensor', () => {
  // A stand-in AbsoluteOrientationSensor: `emit(heading)` gives a reading of the phone
  // lying flat, top of the screen toward `heading` (a turn of -heading about up).
  const installSensor = ({ failOnStart = false } = {}) => {
    const instances = [];
    window.AbsoluteOrientationSensor = class {
      constructor(options) {
        this.options = options;
        this.listeners = {};
        this.stop = vi.fn();
        instances.push(this);
      }
      addEventListener(type, fn) { this.listeners[type] = fn; }
      start() {
        if (failOnStart) queueMicrotask(() => this.listeners.error?.({ error: { name: 'NotAllowedError' } }));
      }
      emit(heading, ms = 16) {
        act(() => vi.advanceTimersByTime(ms));
        const h = (-heading * Math.PI) / 180;
        this.quaternion = [0, 0, Math.sin(h / 2), Math.cos(h / 2)];
        act(() => this.listeners.reading());
      }
    };
    return instances;
  };

  it('is preferred: its readings steer AR Scan, and the orientation events are ignored meanwhile', async () => {
    const sensors = installSensor();
    await openAr({ target: { name: 'E', lat: HERE.lat, lng: 80.0540 } }); // due east
    expect(sensors).toHaveLength(1);
    expect(sensors[0].options).toMatchObject({ referenceFrame: 'device' });
    for (let i = 0; i < 20; i++) sensors[0].emit(0);
    const decl = magneticDeclination(12.82, 80.04);
    expect(rotation()).toBeCloseTo(90 - decl, 0);
    // A second of orientation events saying the opposite, between sensor readings: all
    // ignored while the sensor is fresh (taken in, they would drag the heading round).
    for (let i = 0; i < 40; i++) {
      compass(170, 12);
      sensors[0].emit(0, 12);
    }
    expect(rotation()).toBeCloseTo(90 - decl, 0);
  });

  it('lets the orientation events back in once its readings stop', async () => {
    const sensors = installSensor();
    await openAr({ target: { name: 'E', lat: HERE.lat, lng: 80.0540 } });
    for (let i = 0; i < 20; i++) sensors[0].emit(0);
    act(() => vi.advanceTimersByTime(600)); // past FUSED_SENSOR_FRESH_MS
    for (let i = 0; i < 20; i++) compass(180, 120);
    const decl = magneticDeclination(12.82, 80.04);
    expect(rotation()).toBeCloseTo(90 - (180 + decl), 0);
  });

  it('hands back to the orientation events when it stops reading or fails', async () => {
    const sensors = installSensor({ failOnStart: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openAr({ target: { name: 'E', lat: HERE.lat, lng: 80.0540 } });
    await act(async () => {});
    expect(sensors[0].stop).toHaveBeenCalled();
    for (let i = 0; i < 20; i++) compass(180, 120);
    const decl = magneticDeclination(12.82, 80.04);
    expect(rotation()).toBeCloseTo(90 - (180 + decl), 0);
    warn.mockRestore();
  });
});

describe('the focused tag', () => {
  // A building `meters` away, `bearing` degrees from true north.
  const bldg = (id, bearing, meters) => {
    const r = (bearing * Math.PI) / 180;
    return {
      id, name: `B_${id}`,
      lat: HERE.lat + (meters * Math.cos(r)) / 111320,
      lng: HERE.lng + (meters * Math.sin(r)) / (111320 * Math.cos((HERE.lat * Math.PI) / 180)),
    };
  };
  const focused = () => screen.getAllByTestId('ar-tag').filter((el) => el.dataset.focused).map((el) => el.textContent);

  it('highlights the tag nearest the centre, and moves only after another has been nearer for 400 ms', async () => {
    const target = { name: 'FAR_AWAY', ...north(-3000) }; // behind: an edge tag, never focused
    const view = await openAr({ target, buildings: [bldg(1, 2, 150), bldg(2, -15, 200)] });
    for (let i = 0; i < 3; i++) compass(0, 120);
    expect(focused()).toHaveLength(1);
    expect(focused()[0]).toContain('B_1');
    // The buildings move (as they would as you walk): B_2 is now nearer the centre.
    view.rerender(<ARCompass target={target} liveLocation={HERE} buildings={[bldg(1, 14, 150), bldg(2, -1, 200)]} onClose={() => {}} />);
    expect(focused()[0]).toContain('B_1');
    act(() => vi.advanceTimersByTime(350));
    expect(focused()[0]).toContain('B_1');
    act(() => vi.advanceTimersByTime(100));
    expect(focused()).toHaveLength(1);
    expect(focused()[0]).toContain('B_2');
  });
});

describe('tags off-screen', () => {
  it('puts the destination on the edge, with an arrow, when it is behind', async () => {
    await openAr({ target: { name: 'BEHIND_ME', ...north(-200) } });
    for (let i = 0; i < 3; i++) compass(0, 120);
    const tag = screen.getAllByTestId('ar-tag').find((el) => el.dataset.variant === 'target');
    expect(tag.dataset.edge).toMatch(/^(left|right)$/);
    expect(tag.textContent).toContain('BEHIND_ME');
    const left = parseFloat(tag.style.left);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(100);
  });
});
