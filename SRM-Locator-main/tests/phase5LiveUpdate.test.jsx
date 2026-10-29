// @vitest-environment jsdom
//
// Phase 5, JS bundles: a bundle that failed to start is never offered again (a newer one is),
// and a bundle already downloaded is used rather than downloaded again, with every other
// downloaded bundle deleted. Against a fake update plugin and a fake GitHub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const updater = vi.hoisted(() => ({ running: '1.1.2', bundles: [], failedUpdate: null }));

vi.mock('../src/utils/liveUpdater', () => ({
  isLiveUpdaterAvailable: () => true,
  notifyAppReady: () => {},
  CapacitorUpdater: {
    current: async () => ({ bundle: { id: `id-${updater.running}`, version: updater.running } }),
    addListener: async () => ({ remove() {} }),
    download: vi.fn(async ({ version }) => ({ id: `id-${version}`, version, status: 'pending' })),
    set: vi.fn(async () => {}),
    list: vi.fn(async () => ({ bundles: updater.bundles })),
    delete: vi.fn(async () => {}),
    getFailedUpdate: vi.fn(async () => updater.failedUpdate),
  },
}));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.1.0' }) } }));

const { CapacitorUpdater } = await import('../src/utils/liveUpdater');
const { useLiveUpdate, LiveUpdateStatus, __resetLiveColdStartThrottle, APPLYING_BUNDLE_KEY, FAILED_BUNDLES_KEY } = await import('../src/hooks/useLiveUpdate.js');
const { __resetReleasesLookup } = await import('../src/utils/releasesLookup.js');

const SHA = 'f'.repeat(64);
const bundle = (version) => ({
  tag_name: `js-${version}`,
  draft: false,
  prerelease: false,
  body: `notes\nMIN_NATIVE: 1.1.0\nSHA256: ${SHA}`,
  assets: [{ name: 'locus-bundle.zip', browser_download_url: `https://example.test/js-${version}.zip`, size: 600000 }],
});
const github = (releases) => { globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => releases })); };
const settle = () => act(async () => {});
const launch = async () => {
  cleanup();
  __resetLiveColdStartThrottle();
  __resetReleasesLookup();
  const hook = renderHook(() => useLiveUpdate());
  await settle();
  await settle();
  return hook;
};

beforeEach(() => {
  localStorage.clear();
  updater.running = '1.1.2';
  updater.bundles = [];
  updater.failedUpdate = null;
  for (const fn of Object.values(CapacitorUpdater)) fn.mockClear?.();
});
afterEach(() => cleanup());

describe('2. a bundle that failed to start', () => {
  it('is not offered again on the next launch', async () => {
    github([bundle('1.1.3')]);
    const first = await launch();
    expect(first.result.current.status).toBe(LiveUpdateStatus.READY);
    await act(async () => first.result.current.applyNow());
    expect(localStorage.getItem(APPLYING_BUNDLE_KEY)).toBe('1.1.3');

    // The new bundle never told the plugin it started: the next launch is back on 1.1.2.
    const next = await launch();
    expect(next.result.current.status).toBe(LiveUpdateStatus.IDLE);
    expect(next.result.current.visible).toBe(false);
    expect(JSON.parse(localStorage.getItem(FAILED_BUNDLES_KEY))).toEqual(['1.1.3']);
    expect(CapacitorUpdater.download).toHaveBeenCalledTimes(1);
  });

  it('a newer version than the broken one is offered as usual', async () => {
    localStorage.setItem(FAILED_BUNDLES_KEY, JSON.stringify(['1.1.3']));
    github([bundle('1.1.4'), bundle('1.1.3')]);
    const hook = await launch();
    expect(hook.result.current.status).toBe(LiveUpdateStatus.READY);
    expect(hook.result.current.manifest.version).toBe('1.1.4');
  });

  it("is also recognised from the plugin's own record", async () => {
    updater.failedUpdate = { bundle: { id: 'id-1.1.3', version: '1.1.3' } };
    github([bundle('1.1.3')]);
    const hook = await launch();
    expect(hook.result.current.status).toBe(LiveUpdateStatus.IDLE);
  });

  it('a bundle that started is not marked broken', async () => {
    localStorage.setItem(APPLYING_BUNDLE_KEY, '1.1.3');
    updater.running = '1.1.3';
    github([bundle('1.1.3')]);
    await launch();
    expect(localStorage.getItem(APPLYING_BUNDLE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(FAILED_BUNDLES_KEY))).toEqual([]);
  });
});

describe('3. a bundle already downloaded', () => {
  it('is used rather than downloaded again, and older downloads are deleted', async () => {
    updater.bundles = [
      { id: 'id-1.1.2', version: '1.1.2', status: 'success' }, // the one running
      { id: 'id-1.1.1', version: '1.1.1', status: 'success' }, // an old download
      { id: 'id-1.1.3', version: '1.1.3', status: 'pending' }, // downloaded on the last launch
    ];
    github([bundle('1.1.3')]);
    const hook = await launch();
    expect(hook.result.current.status).toBe(LiveUpdateStatus.READY);
    expect(CapacitorUpdater.download).not.toHaveBeenCalled();
    expect(CapacitorUpdater.delete.mock.calls).toEqual([[{ id: 'id-1.1.1' }]]);
    await act(async () => hook.result.current.applyNow());
    expect(CapacitorUpdater.set).toHaveBeenCalledWith(expect.objectContaining({ id: 'id-1.1.3' }));
  });

  it('a newer release replaces an older download: it is deleted and the new one downloaded', async () => {
    updater.bundles = [{ id: 'id-1.1.3', version: '1.1.3', status: 'pending' }];
    github([bundle('1.1.4')]);
    const hook = await launch();
    expect(CapacitorUpdater.delete.mock.calls).toEqual([[{ id: 'id-1.1.3' }]]);
    expect(CapacitorUpdater.download).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe(LiveUpdateStatus.READY);
  });
});
