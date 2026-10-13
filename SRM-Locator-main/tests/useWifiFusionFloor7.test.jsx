// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// The Floor 7 demo module is a separate chunk: loaded and handed to startWifiFusion when
// FLOOR7_DEMO is on (the test build), and never touched otherwise - even with WiFi on.
const calls = vi.hoisted(() => ({ demoLoads: 0, demoOptions: 0, startArgs: [] }));

async function loadHook({ demo }) {
  vi.resetModules();
  vi.doMock('../src/utils/positionSource.js', async (importOriginal) => ({
    ...(await importOriginal()),
    WIFI_POSITIONING_ENABLED: true,
    FLOOR7_DEMO: demo,
  }));
  vi.doMock('../src/utils/wifiFusion.js', () => ({
    startWifiFusion: vi.fn((options) => {
      calls.startArgs.push(options);
      return { resolve: vi.fn(), stop: vi.fn(), indoor: () => null, lastCycle: () => null, subscribe: () => () => {} };
    }),
  }));
  vi.doMock('../src/utils/floor7Demo.js', () => {
    calls.demoLoads++;
    return { floor7FusionOptions: () => (calls.demoOptions++, { tracker: 'THE-TRACKER' }) };
  });
  return (await import('../src/hooks/useWifiFusion.js')).useWifiFusion;
}

const settle = () => act(async () => {});

beforeEach(() => {
  calls.demoLoads = 0;
  calls.demoOptions = 0;
  calls.startArgs = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Floor 7 demo in the hook', () => {
  it('in the test build, loads the demo and starts fusion with its tracker', async () => {
    const useWifiFusion = await loadHook({ demo: true });
    renderHook(() => useWifiFusion(true));
    await settle();
    expect(calls.demoLoads).toBe(1);
    expect(calls.demoOptions).toBe(1);
    expect(calls.startArgs).toEqual([{ tracker: 'THE-TRACKER' }]);
  });

  it('anywhere else, never loads the demo, and starts fusion exactly as before', async () => {
    const useWifiFusion = await loadHook({ demo: false });
    renderHook(() => useWifiFusion(true));
    await settle();
    expect(calls.demoLoads).toBe(0);
    expect(calls.demoOptions).toBe(0);
    expect(calls.startArgs).toEqual([undefined]);
  });

  it('does not touch the demo while inactive', async () => {
    const useWifiFusion = await loadHook({ demo: true });
    renderHook(() => useWifiFusion(false));
    await settle();
    expect(calls.demoLoads).toBe(0);
    expect(calls.startArgs).toEqual([]);
  });
});
