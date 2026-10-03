// @vitest-environment jsdom
//
// The shared "glide the map to this point" action (src/utils/mapFocus.js): one glide at a
// time, a touch on the map stops it, no coordinates does nothing, and reduced motion
// shortens it. Driven through a fake engine driver; nothing about it is Leaflet or Google.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  focusMapOn, registerMapDriver, cancelMapFocus,
  MAP_FOCUS_DURATION_MS, MAP_FOCUS_REDUCED_MS, MAP_FOCUS_EASING,
} from '../src/utils/mapFocus.js';

let view;
let off;
let element;
const reduced = (on) => {
  window.matchMedia = vi.fn(() => ({ matches: on }));
};
const register = (extra = {}) => {
  off = registerMapDriver({
    element,
    getView: () => ({ ...view }),
    setView: (v) => { view = { ...v }; },
    ...extra,
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  view = { lat: 0, lng: 0, zoom: 10 };
  element = document.createElement('div');
  reduced(false);
});
afterEach(() => {
  off?.();
  off = null;
  vi.useRealTimers();
});

describe('focusMapOn', () => {
  it('glides there over the set duration, easing in and out, and reports when it arrives', () => {
    register();
    const onDone = vi.fn();
    expect(focusMapOn({ lat: 10, lng: 20, zoom: 19 }, { onDone })).toBe(true);

    vi.advanceTimersByTime(MAP_FOCUS_DURATION_MS / 2);
    expect(view.lat).toBeCloseTo(5, 0);
    expect(view.zoom).toBeCloseTo(14.5, 0);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MAP_FOCUS_DURATION_MS);
    expect(view).toEqual({ lat: 10, lng: 20, zoom: 19 });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(MAP_FOCUS_EASING(0)).toBe(0);
    expect(MAP_FOCUS_EASING(1)).toBe(1);
  });

  it('redirects a glide in progress to the new target, without stacking', () => {
    register();
    const first = vi.fn();
    const second = vi.fn();
    focusMapOn({ lat: 10, lng: 0, zoom: 19 }, { onDone: first });
    vi.advanceTimersByTime(600);
    focusMapOn({ lat: -10, lng: 0, zoom: 19 }, { onDone: second });
    vi.advanceTimersByTime(MAP_FOCUS_DURATION_MS * 2);
    expect(view.lat).toBe(-10);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops the moment the user touches the map', () => {
    register();
    const onDone = vi.fn();
    focusMapOn({ lat: 10, lng: 0, zoom: 19 }, { onDone });
    vi.advanceTimersByTime(600);
    element.dispatchEvent(new Event('touchstart'));
    const stopped = { ...view };
    vi.advanceTimersByTime(MAP_FOCUS_DURATION_MS * 2);
    expect(view).toEqual(stopped);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('does nothing without coordinates', () => {
    register();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(focusMapOn({ lat: undefined, lng: 5 })).toBe(false);
    expect(focusMapOn(undefined)).toBe(false);
    vi.advanceTimersByTime(MAP_FOCUS_DURATION_MS);
    expect(view).toEqual({ lat: 0, lng: 0, zoom: 10 });
    warn.mockRestore();
  });

  it('returns false when no map has registered yet', () => {
    expect(focusMapOn({ lat: 1, lng: 1 })).toBe(false);
  });

  it('takes only a short move when the device asks for reduced motion', () => {
    reduced(true);
    register();
    focusMapOn({ lat: 10, lng: 0, zoom: 19 });
    vi.advanceTimersByTime(MAP_FOCUS_REDUCED_MS + 50);
    expect(view.lat).toBe(10);
  });

  it("uses the engine's own animated move when it has one, and cancels it on redirect", () => {
    const cancel = vi.fn();
    const fly = vi.fn(() => cancel);
    register({ fly });
    focusMapOn({ lat: 1, lng: 2, zoom: 19 });
    expect(fly).toHaveBeenCalledWith({ lat: 1, lng: 2, zoom: 19 }, MAP_FOCUS_DURATION_MS, expect.any(Function));
    focusMapOn({ lat: 3, lng: 4, zoom: 19 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a running glide when the map unmounts', () => {
    register();
    focusMapOn({ lat: 10, lng: 0, zoom: 19 });
    vi.advanceTimersByTime(300);
    off();
    off = null;
    const stopped = { ...view };
    vi.advanceTimersByTime(MAP_FOCUS_DURATION_MS);
    expect(view).toEqual(stopped);
    expect(focusMapOn({ lat: 1, lng: 1 })).toBe(false);
  });

  it('cancelMapFocus is safe with nothing running', () => {
    expect(() => cancelMapFocus()).not.toThrow();
  });
});
