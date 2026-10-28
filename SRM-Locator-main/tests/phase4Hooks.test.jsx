// @vitest-environment jsdom
//
// Phase 4 fixes below App.jsx:
//  - the group panel: a second finger landing mid-drag no longer leaves it stuck half-way;
//  - AR Scan's position: `lowAccuracy` while the latest fix is rougher than AR_MIN_ACCURACY_M;
//  - the compass away from AR Scan: turned with the screen (landscape was 90 deg out);
//  - a map marker with no real position draws nothing, instead of Leaflet throwing.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, act, cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { usePanelMotion } from '../src/hooks/usePanelMotion.js';
import { useArPosition, AR_MIN_ACCURACY_M } from '../src/hooks/useArPosition.js';
import { useDeviceHeading } from '../src/hooks/useDeviceHeading.js';

MotionGlobalConfig.skipAnimations = true;

const map = vi.hoisted(() => ({ added: 0 }));
vi.mock('react-leaflet', () => ({
  useMap: () => ({
    addLayer: () => { map.added += 1; },
    removeLayer: () => {},
    hasLayer: () => false,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const touch = (el, type, ys) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { touches: ys.map((clientY) => ({ clientX: 100, clientY })) });
  act(() => { el.dispatchEvent(event); });
};

describe('group panel drag', () => {
  it('a second finger landing mid-drag still lets the drag settle when the fingers lift', () => {
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    const onClose = vi.fn();
    const { result } = renderHook(() => usePanelMotion({
      enabled: true, open: true, onOpen: vi.fn(), onClose, panelRef: { current: panel }, listRef: { current: null },
    }));
    touch(panel, 'touchstart', [100]);
    touch(panel, 'touchmove', [200]);
    touch(panel, 'touchmove', [600]);
    expect(result.current.y.get()).toBeGreaterThan(300);
    touch(panel, 'touchstart', [600, 650]);
    touch(panel, 'touchend', [650]);
    touch(panel, 'touchend', []);
    expect(onClose).toHaveBeenCalled();
    panel.remove();
  });
});

describe('useArPosition().lowAccuracy', () => {
  it('is true while the latest fix is rougher than AR_MIN_ACCURACY_M, and false again once it settles', () => {
    let send;
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { watchPosition: (ok) => { send = ok; return 1; }, clearWatch: () => {} },
    });
    expect(AR_MIN_ACCURACY_M).toBe(25);
    const { result } = renderHook(() => useArPosition({ lat: 12.82, lng: 80.04 }));
    expect(result.current.lowAccuracy).toBe(false);
    const fix = (accuracy) => act(() => send({ coords: { latitude: 12.8231, longitude: 80.0441, accuracy }, timestamp: Date.now() }));
    fix(60);
    expect(result.current.lowAccuracy).toBe(true);
    fix(8);
    expect(result.current.lowAccuracy).toBe(false);
  });
});

describe('useDeviceHeading away from AR Scan', () => {
  const orient = (fields) => {
    const event = new Event('deviceorientationabsolute');
    Object.assign(event, { absolute: true, ...fields });
    act(() => { window.dispatchEvent(event); });
  };
  const withScreenAngle = (angle) => {
    Object.defineProperty(window.screen, 'orientation', { value: { angle }, configurable: true });
  };
  afterEach(() => { delete window.screen.orientation; });

  const heading = async (angle, fields) => {
    withScreenAngle(angle);
    const { result } = renderHook(() => useDeviceHeading());
    await act(async () => { await result.current.requestHeadingPermission(); });
    orient(fields);
    return result.current.headingRef.current;
  };

  it('lying flat in portrait is the top of the phone, as before', async () => {
    expect(await heading(0, { alpha: 30, beta: 0, gamma: 0 })).toBeCloseTo(330, 0);
  });

  it('lying flat in landscape is the top of the screen, 90 deg on from the top of the phone', async () => {
    expect(await heading(90, { alpha: 30, beta: 0, gamma: 0 })).toBeCloseTo(60, 0);
  });

  it('held up in landscape is where the back of the phone points', async () => {
    expect(await heading(90, { alpha: 30, beta: 10, gamma: -80 })).toBeCloseTo(58.5, 0);
  });

  it('with no tilt in the event, still turns with the screen', async () => {
    expect(await heading(270, { alpha: 30, beta: null, gamma: null })).toBeCloseTo(240, 0);
  });
});

describe('LeafletReactMarker', () => {
  it('draws nothing, and does not throw, for a marker with no real position', async () => {
    const { default: LeafletReactMarker } = await import('../src/components/LeafletReactMarker.jsx');
    map.added = 0;
    expect(() => render(<LeafletReactMarker lat={undefined} lng={80.04}><span /></LeafletReactMarker>)).not.toThrow();
    expect(() => render(<LeafletReactMarker lat={NaN} lng={NaN}><span /></LeafletReactMarker>)).not.toThrow();
    expect(map.added).toBe(0);
    render(<LeafletReactMarker lat={12.82} lng={80.04}><span /></LeafletReactMarker>);
    expect(map.added).toBe(1);
  });
});
