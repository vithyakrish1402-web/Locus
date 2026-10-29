// @vitest-environment jsdom
//
// Phase 5, the app's updates: Check for updates after Later, a checked APK kept across launches,
// a check that can't hang, the app update and Send LOCUS taking turns, and a mandatory update
// that still gates on a launch with no signal. Against a fake native plugin and a fake GitHub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

const native = vi.hoisted(() => ({ listeners: {}, plugin: null }));
// utils/locusUpdater.js's queueDownload, as it is, afresh for each test.
const queue = vi.hoisted(() => {
  let tail = Promise.resolve();
  const run = (task) => {
    const turn = tail.then(task, task);
    tail = turn.catch(() => {});
    return turn;
  };
  run.reset = () => { tail = Promise.resolve(); };
  return run;
});
const installed = vi.hoisted(() => ({ version: '1.1.0' }));

vi.mock('../src/utils/locusUpdater.js', () => {
  native.plugin = {
    getInstallPermissionStatus: vi.fn(async () => ({ granted: true })),
    openInstallSettings: vi.fn(async () => {}),
    download: vi.fn(),
    install: vi.fn(async () => {}),
    shareFile: vi.fn(async () => {}),
    cancelDownload: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}),
    addListener: vi.fn(async (name, fn) => {
      (native.listeners[name] ??= []).push(fn);
      return { remove() {} };
    }),
  };
  return { LocusUpdater: native.plugin, isUpdaterAvailable: () => true, queueDownload: queue };
});
vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ version: installed.version }), addListener: async () => ({ remove() {} }) },
}));

import {
  useAppUpdate, UpdateStatus, __resetColdStartThrottle, DOWNLOADED_APK_KEY, MANDATORY_UPDATE_KEY,
} from '../src/hooks/useAppUpdate.js';
import { useShareInstaller, ShareStatus } from '../src/hooks/useShareInstaller.js';
import { __resetReleasesLookup, UPDATE_CHECK_TIMEOUT_MS } from '../src/utils/releasesLookup.js';

const SHA = 'a'.repeat(64);
const release = (version = '1.2.0', extra = '') => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  body: `Fixes.\n${extra}\nSHA256: ${SHA}`,
  assets: [{ name: 'locus-latest.apk', browser_download_url: `https://example.test/v${version}.apk`, size: 1000 }],
});
const github = (releases) => vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200, ok: true, json: async () => releases });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const settle = () => act(async () => {});
/** A new launch: the cold-start check and the launch's releases answer start afresh. */
const relaunch = () => {
  cleanup();
  __resetColdStartThrottle();
  __resetReleasesLookup();
};

beforeEach(() => {
  queue.reset();
  localStorage.clear();
  installed.version = '1.1.0';
  native.listeners = {};
  __resetColdStartThrottle();
  __resetReleasesLookup();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const fn of Object.values(native.plugin)) fn.mockClear?.();
});

describe('1. Check for updates after Later', () => {
  it('shows the update screen again', async () => {
    github([release()]);
    const hook = renderHook(() => useAppUpdate());
    await settle();
    expect(hook.result.current.status).toBe(UpdateStatus.AVAILABLE);
    act(() => hook.result.current.dismiss());
    expect(hook.result.current.dismissed).toBe(true);
    await act(async () => hook.result.current.check({ manual: true }));
    expect(hook.result.current.status).toBe(UpdateStatus.AVAILABLE);
    expect(hook.result.current.dismissed).toBe(false);
  });
});

describe('3. an APK downloaded and checked, not yet installed', () => {
  it('is used on the next launch, not downloaded again', async () => {
    github([release()]);
    const first = renderHook(() => useAppUpdate());
    await settle();
    native.plugin.download.mockResolvedValueOnce({ path: '/cache/updates/locus-latest.apk' });
    await act(async () => first.result.current.startDownload());
    expect(first.result.current.status).toBe(UpdateStatus.READY);
    expect(native.plugin.download).toHaveBeenCalledTimes(1);

    relaunch();
    const second = renderHook(() => useAppUpdate());
    await settle();
    await act(async () => second.result.current.startDownload());
    expect(second.result.current.status).toBe(UpdateStatus.READY);
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
    await act(async () => second.result.current.installUpdate());
    expect(native.plugin.install).toHaveBeenCalledWith({ path: '/cache/updates/locus-latest.apk' });
  });

  it('is not used for a different release (another checksum)', async () => {
    localStorage.setItem(DOWNLOADED_APK_KEY, JSON.stringify({ version: '1.2.0', sha256: 'b'.repeat(64), path: '/old.apk' }));
    github([release()]);
    const hook = renderHook(() => useAppUpdate());
    await settle();
    native.plugin.download.mockResolvedValueOnce({ path: '/cache/updates/locus-latest.apk' });
    await act(async () => hook.result.current.startDownload());
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
  });

  it('is deleted from the phone once that version is installed', async () => {
    localStorage.setItem(DOWNLOADED_APK_KEY, JSON.stringify({ version: '1.2.0', sha256: SHA, path: '/x.apk' }));
    installed.version = '1.2.0';
    github([release()]);
    renderHook(() => useAppUpdate());
    await settle();
    expect(native.plugin.clearCache).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DOWNLOADED_APK_KEY)).toBeNull();
  });

  it('a kept file that has gone is downloaded afresh on Try again', async () => {
    localStorage.setItem(DOWNLOADED_APK_KEY, JSON.stringify({ version: '1.2.0', sha256: SHA, path: '/gone.apk' }));
    github([release()]);
    const hook = renderHook(() => useAppUpdate());
    await settle();
    await act(async () => hook.result.current.startDownload());
    native.plugin.install.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'NOT_FOUND' }));
    await act(async () => hook.result.current.installUpdate());
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(localStorage.getItem(DOWNLOADED_APK_KEY)).toBeNull();
    native.plugin.download.mockResolvedValueOnce({ path: '/cache/updates/locus-latest.apk' });
    await act(async () => hook.result.current.startDownload());
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
  });
});

describe('4. a check with no answer', () => {
  it(`ends in "Couldn't check" after ${UPDATE_CHECK_TIMEOUT_MS / 1000} s`, async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {})); // ignores its abort signal
    const hook = renderHook(() => useAppUpdate());
    // The launch's own check ends quietly first (it never interrupts anyone).
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS); });
    expect(hook.result.current.status).toBe(UpdateStatus.IDLE);
    act(() => { hook.result.current.check({ manual: true }); });
    expect(hook.result.current.status).toBe(UpdateStatus.CHECKING);
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS); });
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(hook.result.current.error.code).toBe('TIMEOUT');
  });
});

describe('5. the app update and Send LOCUS', () => {
  const installer = { version: '1.1.0', apkUrl: 'https://example.test/v1.1.0.apk', apkSize: 1000, sha256: SHA };

  it('take turns instead of cancelling each other', async () => {
    github([release()]);
    const app = renderHook(() => useAppUpdate());
    const share = renderHook(() => useShareInstaller(installer));
    await settle();
    const sendAnswer = deferred();
    const updateAnswer = deferred();
    native.plugin.download.mockImplementationOnce(() => sendAnswer.promise).mockImplementationOnce(() => updateAnswer.promise);

    await act(async () => { share.result.current.send(); });
    await act(async () => { app.result.current.startDownload(); });
    // The update waits its turn: only Send LOCUS's download has started, and nothing was cancelled.
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
    expect(native.plugin.cancelDownload).not.toHaveBeenCalled();
    expect(app.result.current.status).toBe(UpdateStatus.DOWNLOADING);

    // Send LOCUS's progress does not move the update's screen.
    await act(async () => native.listeners.downloadProgress.forEach((fn) => fn({ stage: 'downloading', loaded: 500, total: 1000, percent: 50 })));
    expect(share.result.current.progress.percent).toBe(50);
    expect(app.result.current.progress.percent).toBe(-1);

    await act(async () => sendAnswer.resolve({ path: '/cache/updates/LOCUS-1.1.0.apk' }));
    expect(share.result.current.status).toBe(ShareStatus.READY);
    expect(native.plugin.download).toHaveBeenCalledTimes(2);
    await act(async () => updateAnswer.resolve({ path: '/cache/updates/locus-latest.apk' }));
    expect(app.result.current.status).toBe(UpdateStatus.READY);
  });

  it('a stalled one gives its turn up, so the other still runs', async () => {
    vi.useFakeTimers();
    github([release()]);
    const app = renderHook(() => useAppUpdate({ stallTimeoutMs: 1000 }));
    const share = renderHook(() => useShareInstaller(installer, { stallTimeoutMs: 1000 }));
    await act(async () => {});
    native.plugin.download.mockImplementationOnce(() => new Promise(() => {})); // never answers
    native.plugin.download.mockImplementationOnce(async () => ({ path: '/cache/updates/locus-latest.apk' }));
    await act(async () => { share.result.current.send(); });
    await act(async () => { app.result.current.startDownload(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(share.result.current.status).toBe(ShareStatus.ERROR);
    expect(app.result.current.status).toBe(UpdateStatus.READY);
  });
});

describe('12. a mandatory update', () => {
  it('still gates on a launch with no signal', async () => {
    github([release('1.2.0', 'MANDATORY: true')]);
    const first = renderHook(() => useAppUpdate());
    await settle();
    expect(first.result.current.mandatory).toBe(true);
    expect(JSON.parse(localStorage.getItem(MANDATORY_UPDATE_KEY)).version).toBe('1.2.0');

    relaunch();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = renderHook(() => useAppUpdate());
    await settle();
    expect(offline.result.current.mandatory).toBe(true);
    expect(offline.result.current.status).toBe(UpdateStatus.AVAILABLE);
    expect(offline.result.current.manifest.version).toBe('1.2.0');
  });

  it('gates through a newer, non-mandatory release, and is forgotten once installed', async () => {
    localStorage.setItem(MANDATORY_UPDATE_KEY, JSON.stringify({ version: '1.2.0', sha256: SHA, apkUrl: 'x', mandatory: true }));
    github([release('1.3.0')]);
    const hook = renderHook(() => useAppUpdate());
    await settle();
    expect(hook.result.current.mandatory).toBe(true);
    expect(hook.result.current.manifest.version).toBe('1.3.0');

    relaunch();
    installed.version = '1.3.0';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const after = renderHook(() => useAppUpdate());
    await settle();
    expect(after.result.current.mandatory).toBe(false);
    expect(localStorage.getItem(MANDATORY_UPDATE_KEY)).toBeNull();
  });

  it('notes that only mention [MANDATORY] do not gate', async () => {
    github([release('1.2.0', 'We stopped using [MANDATORY] for small fixes.')]);
    const hook = renderHook(() => useAppUpdate());
    await settle();
    expect(hook.result.current.status).toBe(UpdateStatus.AVAILABLE);
    expect(hook.result.current.mandatory).toBe(false);
  });
});
