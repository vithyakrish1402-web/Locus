// @vitest-environment jsdom
//
// WiFi Arc Stage 7: the floor picker's state. Browsing is purely local; the return chip
// appears only after RETURN_CHIP_DELAY_MS on a floor you aren't on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// The hook is a constant null unless WiFi positioning is on (it ships off); on for these.
vi.mock('../src/utils/positionSource.js', async (importOriginal) => ({
  ...(await importOriginal()),
  WIFI_POSITIONING_ENABLED: true,
}));
// The survey table behind a GPS-only picker: TECH PARK has floors 0, 1, 2 and 7.
const survey = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/utils/wifiPositioning.js', () => ({
  loadAccessPoints: async () => {
    if (survey.fail) throw Object.assign(new Error('offline'), { code: 'unavailable' });
    return new Map([0, 1, 2, 7].map((floor) => [`ap-${floor}`, { building: 'TECH PARK', floor }]));
  },
  surveyedFloors: (aps, building) => [...aps.values()].filter((ap) => ap.building === building).map((ap) => ap.floor),
}));
const { useIndoorView } = await import('../src/hooks/useIndoorView.js');
import { RETURN_CHIP_DELAY_MS } from '../src/utils/indoorView.js';

const at = (floor, building = 'TECH PARK') => ({ lat: 1, lng: 2, building, floor, confidence: 0.8, floors: [0, 1, 2, 7] });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = (indoor, gpsBuilding = null) =>
  renderHook(({ indoor, gpsBuilding }) => useIndoorView(indoor, gpsBuilding), { initialProps: { indoor, gpsBuilding } });

describe('useIndoorView, WiFi positioning on', () => {
  it('is null with no indoor reading - no picker at all', () => {
    expect(mount(null).result.current).toBeNull();
  });

  it('starts on your live floor, with the survey floors as tabs', () => {
    const { result } = mount(at(1));
    expect(result.current).toMatchObject({ building: 'TECH PARK', floors: [0, 1, 2, 7], liveFloor: 1, viewedFloor: 1, browsing: false, showReturnChip: false });
  });

  it('browses another floor without touching the live one', () => {
    const { result } = mount(at(1));
    act(() => result.current.selectFloor(7));
    expect(result.current).toMatchObject({ liveFloor: 1, viewedFloor: 7, browsing: true });
  });

  it('slides the return chip in only after the delay, and it takes you back', () => {
    const { result } = mount(at(1));
    act(() => result.current.selectFloor(7));
    act(() => vi.advanceTimersByTime(RETURN_CHIP_DELAY_MS - 1));
    expect(result.current.showReturnChip).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.showReturnChip).toBe(true);

    act(() => result.current.returnToLive());
    expect(result.current).toMatchObject({ viewedFloor: 1, browsing: false, showReturnChip: false });
  });

  it('restarts the chip timer for every new floor picked', () => {
    const { result } = mount(at(1));
    act(() => result.current.selectFloor(7));
    act(() => vi.advanceTimersByTime(RETURN_CHIP_DELAY_MS));
    act(() => result.current.selectFloor(2));
    expect(result.current.showReturnChip).toBe(false);
    act(() => vi.advanceTimersByTime(RETURN_CHIP_DELAY_MS));
    expect(result.current.showReturnChip).toBe(true);
  });

  it('dismisses the chip by itself when you tap your own floor again', () => {
    const { result } = mount(at(1));
    act(() => result.current.selectFloor(7));
    act(() => vi.advanceTimersByTime(RETURN_CHIP_DELAY_MS));
    act(() => result.current.selectFloor(1));
    expect(result.current).toMatchObject({ browsing: false, showReturnChip: false });
  });

  it('stops browsing when your live floor reaches the one you picked', () => {
    const { result, rerender } = mount(at(1));
    act(() => result.current.selectFloor(2));
    rerender({ indoor: at(2) });
    expect(result.current).toMatchObject({ liveFloor: 2, viewedFloor: 2, browsing: false });
  });

  it('keeps browsing if your live floor changes to another one', () => {
    const { result, rerender } = mount(at(1));
    act(() => result.current.selectFloor(7));
    rerender({ indoor: at(0) });
    expect(result.current).toMatchObject({ liveFloor: 0, viewedFloor: 7, browsing: true });
  });

  it('forgets the pick once you leave coverage, so you come back on your live floor', () => {
    const { result, rerender } = mount(at(1));
    act(() => result.current.selectFloor(7));
    rerender({ indoor: null });
    expect(result.current).toBeNull();
    rerender({ indoor: at(1) });
    expect(result.current).toMatchObject({ viewedFloor: 1, browsing: false });
  });
});

describe('useIndoorView, WiFi positioning off', () => {
  it('is always null, whatever it is handed', async () => {
    vi.resetModules();
    vi.doMock('../src/utils/positionSource.js', async (importOriginal) => ({
      ...(await importOriginal()),
      WIFI_POSITIONING_ENABLED: false,
    }));
    const { useIndoorView: offHook } = await import('../src/hooks/useIndoorView.js');
    const { result } = renderHook(() => offHook(at(1)));
    expect(result.current).toBeNull();
    vi.doUnmock('../src/utils/positionSource.js');
  });
});

// The floor list arrives through a dynamic import and an async table read.
const settle = () =>
  act(async () => {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
  });

describe('useIndoorView, in a building with no indoor reading', () => {
  beforeEach(() => {
    survey.fail = false;
  });

  it('is null when your GPS fix is in no building', () => {
    expect(mount(null, null).result.current).toBeNull();
  });

  it('lists the surveyed floors, none open, no live floor', async () => {
    const { result } = mount(null, 'TECH PARK');
    expect(result.current).toMatchObject({ building: 'TECH PARK', floors: [], liveFloor: null, viewedFloor: null });
    await settle();
    expect(result.current).toMatchObject({ floors: [0, 1, 2, 7], liveFloor: null, viewedFloor: null, browsing: false });
  });

  it('has no floors for a building the survey never covered - or when the table cannot load', async () => {
    const { result } = mount(null, 'UNIVERSITY BUILDING');
    await settle();
    expect(result.current).toMatchObject({ building: 'UNIVERSITY BUILDING', floors: [] });

    survey.fail = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const offline = mount(null, 'TECH PARK');
    await settle();
    expect(offline.result.current).toMatchObject({ building: 'TECH PARK', floors: [] });
  });

  it('opens a floor on a tap, closes it on a second, and never offers a return chip', async () => {
    const { result } = mount(null, 'TECH PARK');
    await settle();
    act(() => result.current.selectFloor(2));
    expect(result.current).toMatchObject({ viewedFloor: 2, browsing: false });
    act(() => vi.advanceTimersByTime(RETURN_CHIP_DELAY_MS));
    expect(result.current.showReturnChip).toBe(false);
    act(() => result.current.selectFloor(2));
    expect(result.current.viewedFloor).toBeNull();
  });

  it('drops the pick when a reading arrives, so you land on your live floor', async () => {
    const { result, rerender } = mount(null, 'TECH PARK');
    await settle();
    act(() => result.current.selectFloor(7));
    rerender({ indoor: at(1), gpsBuilding: 'TECH PARK' });
    expect(result.current).toMatchObject({ liveFloor: 1, viewedFloor: 1, browsing: false });
  });

  it("prefers the reading's building over the GPS one", () => {
    const { result } = mount(at(2), 'TECH PARK 2');
    expect(result.current).toMatchObject({ building: 'TECH PARK', liveFloor: 2 });
  });
});
