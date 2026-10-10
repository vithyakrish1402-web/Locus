// @vitest-environment jsdom
//
// The side-by-side test build ("LOCUS Test", npm run sidetest:install) never checks for or
// offers an update: a live bundle would swap its JavaScript for the published one, and a full
// update would offer the release APK. Every other build is unchanged: on a phone, both checks
// run as before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({ addListener: async () => ({ remove() {} }) }),
}));
vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ version: '1.1.0' }), addListener: async () => ({ remove() {} }) },
}));
vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: { notifyAppReady: async () => {}, current: async () => ({ bundle: { version: 'builtin' } }), addListener: async () => ({ remove() {} }) },
}));

let fetchSpy;
beforeEach(() => {
  vi.resetModules();
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.doUnmock('../src/utils/buildMode.js');
});

const load = async (updatesOff) => {
  vi.doMock('../src/utils/buildMode.js', () => ({ UPDATES_OFF: updatesOff }));
  const { useLiveUpdate } = await import('../src/hooks/useLiveUpdate.js');
  const { useAppUpdate } = await import('../src/hooks/useAppUpdate.js');
  return { useLiveUpdate, useAppUpdate };
};

describe('the test build', () => {
  it('has no live updates and no full updates, and never asks GitHub', async () => {
    const { useLiveUpdate, useAppUpdate } = await load(true);
    const live = renderHook(() => useLiveUpdate());
    const full = renderHook(() => useAppUpdate());
    await act(async () => {});
    expect(live.result.current.supported).toBe(false);
    expect(full.result.current.supported).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('every other build', () => {
  it('checks for both on a phone, as before', async () => {
    const { useLiveUpdate, useAppUpdate } = await load(false);
    const live = renderHook(() => useLiveUpdate());
    const full = renderHook(() => useAppUpdate());
    await act(async () => {});
    expect(live.result.current.supported).toBe(true);
    expect(full.result.current.supported).toBe(true);
    expect(fetchSpy.mock.calls.some(([url]) => /api\.github\.com/.test(String(url)))).toBe(true);
  });
});

describe('the switch itself', () => {
  it('is off in this (test) build: only the sidetest mode turns it on', async () => {
    vi.doUnmock('../src/utils/buildMode.js');
    const { UPDATES_OFF } = await import('../src/utils/buildMode.js');
    expect(import.meta.env.MODE).toBe('test');
    expect(UPDATES_OFF).toBe(false);
  });
});
