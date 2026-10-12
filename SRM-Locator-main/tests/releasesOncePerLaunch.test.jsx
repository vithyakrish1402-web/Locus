// @vitest-environment jsdom
//
// One launch asks GitHub for the releases list once: the APK update check and the live-update
// check both run at launch, and Send LOCUS opened later, all share that answer. Before, each
// asked on its own, three of the 60 requests an hour that everyone on the same network
// (campus Wi-Fi) shares. A manual "Check for updates" still asks again, sending the last
// list's ETag so an unchanged list costs nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ version: '1.1.21' }), addListener: async () => ({ remove() {} }) },
}));
vi.mock('../src/utils/locusUpdater', () => ({
  LocusUpdater: {
    addListener: async () => ({ remove() {} }),
    getInstallPermissionStatus: async () => ({ granted: true }),
    download: () => new Promise(() => {}),
    cancelDownload: async () => {},
  },
  isUpdaterAvailable: () => true,
  canShareInstaller: () => false,
}));
vi.mock('../src/utils/liveUpdater', () => ({
  isLiveUpdaterAvailable: () => true,
  notifyAppReady: () => {},
  CapacitorUpdater: {
    current: async () => ({ bundle: { version: 'builtin' } }),
    addListener: async () => ({ remove() {} }),
    download: () => new Promise(() => {}),
    set: async () => {},
  },
}));

const { useAppUpdate, UpdateStatus, __resetColdStartThrottle } = await import('../src/hooks/useAppUpdate.js');
const { useLiveUpdate, LiveUpdateStatus, __resetLiveColdStartThrottle } = await import('../src/hooks/useLiveUpdate.js');
const { default: SendApp } = await import('../src/components/SendApp.jsx');
const { __resetReleasesLookup } = await import('../src/utils/releasesLookup.js');

const SHA = 'e'.repeat(64);
const release = (tag, asset) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  body: `Notes.\n\nMIN_NATIVE: 1.1.21\nSHA256: ${SHA}`,
  assets: [{ name: asset, browser_download_url: `https://example.test/${tag}/${asset}`, size: 5036092 }],
});
const RELEASES = [release('js-1.1.22', 'locus-bundle.zip'), release('v1.1.21', 'locus-latest.apk')];
const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null });

const probe = {};
function Launch({ sendApp = false }) {
  probe.app = useAppUpdate();
  probe.live = useLiveUpdate();
  return sendApp ? <SendApp openUrl={() => {}} /> : null;
}
const settle = () => act(async () => {});

beforeEach(() => {
  __resetColdStartThrottle();
  __resetLiveColdStartThrottle();
  __resetReleasesLookup();
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: headers({ etag: 'W/"list-1"' }), json: async () => RELEASES }));
});
afterEach(() => {
  cleanup();
});

describe('the releases list, once per launch', () => {
  it('the APK check, the live-update check and Send LOCUS share one request', async () => {
    const { rerender } = render(<Launch />);
    await settle();
    await settle();
    // Both checks ran on that one answer: no newer APK than 1.1.21; js-1.1.22 is downloading.
    expect(probe.app.status).toBe(UpdateStatus.IDLE);
    expect(probe.live.status).toBe(LiveUpdateStatus.DOWNLOADING);
    expect(probe.live.manifest.version).toBe('1.1.22');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    rerender(<Launch sendApp />);
    expect(await screen.findByText(/LOCUS 1\.1\.21/)).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a check that starts after the answer landed reuses it', async () => {
    function AppCheckOnly({ live = false }) {
      probe.app = useAppUpdate();
      return live ? <LiveCheck /> : null;
    }
    function LiveCheck() {
      probe.live = useLiveUpdate();
      return null;
    }
    const { rerender } = render(<AppCheckOnly />);
    await settle();
    await settle();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    rerender(<AppCheckOnly live />);
    await settle();
    await settle();
    expect(probe.live.status).toBe(LiveUpdateStatus.DOWNLOADING);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('Check for updates asks again, sending the last list\'s ETag; unchanged (304) is "up to date"', async () => {
    render(<Launch />);
    await settle();
    await settle();
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 304, headers: headers({}), json: async () => ({}) });
    await act(async () => probe.app.check({ manual: true }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[1][1].headers['If-None-Match']).toBe('W/"list-1"');
    expect(probe.app.status).toBe(UpdateStatus.UP_TO_DATE);
  });

  it('Check for updates refused by GitHub says the update server is busy', async () => {
    render(<Launch />);
    await settle();
    await settle();
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 403, headers: headers({ 'x-ratelimit-remaining': '0' }), json: async () => ({}) });
    await act(async () => probe.app.check({ manual: true }));
    expect(probe.app.status).toBe(UpdateStatus.ERROR);
    expect(probe.app.error.code).toBe('RATE_LIMITED');
  });

  it('a refused launch lookup leaves both checks quiet, and Send LOCUS asks again when opened', async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 403, headers: headers({}), json: async () => ({}) });
    const { rerender } = render(<Launch />);
    await settle();
    await settle();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(probe.app.status).toBe(UpdateStatus.IDLE);
    expect(probe.live.visible).toBe(false);

    rerender(<Launch sendApp />);
    expect(await screen.findByText(/LOCUS 1\.1\.21/)).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
