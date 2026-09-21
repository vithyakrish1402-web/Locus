import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bestFix, createFixPicker } from '../src/bestFix.js';

const fix = (accuracy) => ({ timestamp: 0, coords: { latitude: 12.8, longitude: 80.04, accuracy } });

/** A GPS source the test drives by hand. */
function fakeGeo() {
  const geo = {
    callback: null,
    cleared: [],
    watchPosition: vi.fn(async (_options, callback) => {
      geo.callback = callback;
      return 'watch-1';
    }),
    clearWatch: vi.fn(async ({ id }) => {
      geo.cleared.push(id);
    }),
    emit: (position, err) => geo.callback(position, err),
  };
  return geo;
}

describe('createFixPicker', () => {
  it('keeps the most accurate fix and reports when it is good enough', () => {
    const picker = createFixPicker(10);
    expect(picker.add(fix(30))).toBe(false);
    expect(picker.add(fix(40))).toBe(false);
    expect(picker.best.coords.accuracy).toBe(30);
    expect(picker.add(fix(8))).toBe(true);
    expect(picker.best.coords.accuracy).toBe(8);
    expect(picker.count).toBe(3);
  });

  it('ignores readings without a usable accuracy', () => {
    const picker = createFixPicker(10);
    expect(picker.add({ coords: {} })).toBe(false);
    expect(picker.add(null)).toBe(false);
    expect(picker.best).toBe(null);
    expect(picker.count).toBe(0);
  });
});

describe('bestFix', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops as soon as a fix is good enough and clears its watch', async () => {
    const geo = fakeGeo();
    const result = bestFix(geo, { goodEnoughM: 10, maxWaitMs: 15000 });
    await vi.advanceTimersByTimeAsync(0);
    geo.emit(fix(25));
    geo.emit(fix(6));
    const { position, fixes } = await result;
    expect(position.coords.accuracy).toBe(6);
    expect(fixes).toBe(2);
    expect(geo.cleared).toEqual(['watch-1']);
  });

  it('takes the best fix seen when the window closes without a good one', async () => {
    const geo = fakeGeo();
    const result = bestFix(geo, { goodEnoughM: 10, maxWaitMs: 15000 });
    await vi.advanceTimersByTimeAsync(0);
    geo.emit(fix(34));
    geo.emit(fix(18));
    geo.emit(fix(22));
    await vi.advanceTimersByTimeAsync(15000);
    const { position, fixes } = await result;
    expect(position.coords.accuracy).toBe(18);
    expect(fixes).toBe(3);
  });

  it('rejects when no fix arrived at all', async () => {
    const geo = fakeGeo();
    const result = bestFix(geo, { maxWaitMs: 5000 });
    const settled = expect(result).rejects.toThrow(/No GPS fix within 5 s/);
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
  });

  it("reports the GPS error, if there was one, when no fix arrived", async () => {
    const geo = fakeGeo();
    const result = bestFix(geo, { maxWaitMs: 5000 });
    const settled = expect(result).rejects.toEqual({ message: 'location unavailable' });
    await vi.advanceTimersByTimeAsync(0);
    geo.emit(null, { message: 'location unavailable' });
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
  });

  it('ends the window early when aborted, keeping the best fix so far', async () => {
    const geo = fakeGeo();
    const controller = new AbortController();
    const result = bestFix(geo, { goodEnoughM: 10, maxWaitMs: 15000, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    geo.emit(fix(30));
    controller.abort();
    const { position } = await result;
    expect(position.coords.accuracy).toBe(30);
    expect(geo.cleared).toEqual(['watch-1']);
  });

  it('clears the watch even if the window closed before the watch ID came back', async () => {
    const geo = fakeGeo();
    let releaseId;
    geo.watchPosition = vi.fn((_options, callback) => {
      geo.callback = callback;
      return new Promise((resolve) => (releaseId = () => resolve('late-id')));
    });
    const result = bestFix(geo, { goodEnoughM: 10 });
    geo.emit(fix(5));
    await result;
    releaseId();
    await vi.advanceTimersByTimeAsync(0);
    expect(geo.cleared).toEqual(['late-id']);
  });
});
