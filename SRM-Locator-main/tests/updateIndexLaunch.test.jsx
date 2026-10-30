// @vitest-environment jsdom
//
// A whole launch on the phone, served by the update index: the APK update check, the
// live-update check, and Send LOCUS opened later all share one read of the file, and the
// GitHub API (60 anonymous requests an hour, shared by everyone on campus Wi-Fi) is never asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const native = vi.hoisted(() => ({ get: null }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: (name) => name === 'CapacitorHttp' },
  CapacitorHttp: { get: (...args) => native.get(...args) },
}));
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
  // The real one waits for any earlier download to settle (utils/locusUpdater.js).
  queueDownload: (task) => Promise.resolve().then(task),
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
  prerelease: false,
  body: `Notes.\n\nMIN_NATIVE: 1.1.21\nSHA256: ${SHA}`,
  assets: [{ name: asset, browser_download_url: `https://github.com/vithyakrish1402-web/Locus-Release/releases/download/${tag}/${asset}`, size: 5036092 }],
});
const INDEX = {
  formatVersion: 1,
  generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  releases: [release('js-1.1.24', 'locus-bundle.zip'), release('v1.1.21', 'locus-latest.apk')],
};
const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null });

const probe = {};
function Launch({ sendApp = false }) {
  probe.app = useAppUpdate();
  probe.live = useLiveUpdate();
  return sendApp ? <SendApp openUrl={() => {}} /> : null;
}
const settle = () => act(async () => {});

let warn;
beforeEach(() => {
  __resetColdStartThrottle();
  __resetLiveColdStartThrottle();
  __resetReleasesLookup();
  native.get = vi.fn(async () => ({ status: 200, headers: {}, data: JSON.stringify(INDEX) }));
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: headers({}), json: async () => INDEX.releases }));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  warn.mockRestore();
});

describe('a launch served by the update index', () => {
  it('both checks and Send LOCUS share one read of the file; the API is never asked', async () => {
    const { rerender } = render(<Launch />);
    await settle();
    await settle();
    // No newer APK than 1.1.21; js-1.1.24 is downloading.
    expect(probe.app.status).toBe(UpdateStatus.IDLE);
    expect(probe.live.status).toBe(LiveUpdateStatus.DOWNLOADING);
    expect(probe.live.manifest.version).toBe('1.1.24');

    rerender(<Launch sendApp />);
    expect(await screen.findByText(/LOCUS 1\.1\.21/)).toBeTruthy();
    expect(native.get).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('Check for updates reads the file again, and says "up to date" from it', async () => {
    render(<Launch />);
    await settle();
    await settle();
    await act(async () => probe.app.check({ manual: true }));
    expect(probe.app.status).toBe(UpdateStatus.UP_TO_DATE);
    expect(native.get).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a file that cannot be used costs one API request for the whole launch, as in js-1.1.23', async () => {
    native.get = vi.fn(async () => ({ status: 404, headers: {}, data: 'Not Found' }));
    const { rerender } = render(<Launch />);
    await settle();
    await settle();
    expect(probe.live.status).toBe(LiveUpdateStatus.DOWNLOADING);
    rerender(<Launch sendApp />);
    expect(await screen.findByText(/LOCUS 1\.1\.21/)).toBeTruthy();
    expect(native.get).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
