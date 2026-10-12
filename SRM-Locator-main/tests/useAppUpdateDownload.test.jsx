// @vitest-environment jsdom
//
// The full-APK download, against a fake native plugin: the stages it moves through, the
// stall timeout, and that every way it can end leaves the screen with something to tap.
// Before this, a download that verified moved to READY, opened Android's installer, and
// stayed there with no button whatever the installer did - "stuck at the last percent".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

const native = vi.hoisted(() => ({
  listeners: {},
  resume: null,
  plugin: null,
}));

vi.mock('../src/utils/locusUpdater.js', () => {
  native.plugin = {
    getInstallPermissionStatus: vi.fn(async () => ({ granted: true })),
    openInstallSettings: vi.fn(async () => {}),
    download: vi.fn(),
    install: vi.fn(async () => {}),
    cancelDownload: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}),
    addListener: vi.fn(async (name, fn) => {
      native.listeners[name] = fn;
      return { remove() {} };
    }),
  };
  return { LocusUpdater: native.plugin, isUpdaterAvailable: () => true };
});
vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: async () => ({ version: '1.1.0' }),
    addListener: async (name, fn) => {
      if (name === 'resume') native.resume = fn;
      return { remove() {} };
    },
  },
}));

import { useAppUpdate, UpdateStatus, displayPercent, __resetColdStartThrottle } from '../src/hooks/useAppUpdate.js';
import { __resetReleasesLookup } from '../src/utils/releasesLookup.js';

const SIZE = 12_000_000;
const SHA = 'a'.repeat(64);
const release = {
  tag_name: 'v1.2.0',
  draft: false,
  prerelease: false,
  body: `Fixes.\n\nSHA-256: ${SHA}`,
  assets: [{ name: 'locus-latest.apk', browser_download_url: 'https://example.test/locus-latest.apk', size: SIZE }],
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const nativeError = (code) => Object.assign(new Error(code), { code });

const progress = (loaded, stage = 'downloading') =>
  act(async () => {
    native.listeners.downloadProgress({ stage, loaded, total: SIZE, percent: Math.floor((loaded * 100) / SIZE) });
  });

/** The hook with an update found, as after the cold-start check. */
async function withUpdate(options) {
  const hook = renderHook(() => useAppUpdate(options));
  await act(async () => {});
  expect(hook.result.current.status).toBe(UpdateStatus.AVAILABLE);
  return hook;
}

/** Tap Update now with the native download held open; returns its deferred answer. */
async function startDownload(hook) {
  const answer = deferred();
  native.plugin.download.mockImplementationOnce(() => answer.promise);
  await act(async () => {
    hook.result.current.startDownload();
  });
  return answer;
}

const shown = (hook) => displayPercent(hook.result.current.status, hook.result.current.progress.percent);

beforeEach(() => {
  __resetColdStartThrottle();
  __resetReleasesLookup();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200, ok: true, json: async () => [release] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const fn of Object.values(native.plugin)) fn.mockClear?.();
  native.plugin.getInstallPermissionStatus.mockImplementation(async () => ({ granted: true }));
  native.plugin.install.mockImplementation(async () => {});
});

describe('APK download stages', () => {
  it('goes Downloading -> Checking -> Ready, and shows 100% only once checked', async () => {
    const hook = await withUpdate();
    const answer = await startDownload(hook);
    expect(hook.result.current.status).toBe(UpdateStatus.DOWNLOADING);

    await progress(SIZE / 2);
    expect(shown(hook)).toBe(50);

    // The last byte arrived but nothing is checked yet: never 100.
    await progress(SIZE);
    expect(hook.result.current.status).toBe(UpdateStatus.DOWNLOADING);
    expect(shown(hook)).toBe(99);

    await progress(SIZE, 'verifying');
    expect(hook.result.current.status).toBe(UpdateStatus.VERIFYING);
    expect(shown(hook)).toBe(99);

    await act(async () => answer.resolve({ path: '/cache/updates/locus-latest.apk' }));
    expect(hook.result.current.status).toBe(UpdateStatus.READY);
    expect(shown(hook)).toBe(100);
    // Ready waits for the tap; nothing is handed to Android yet.
    expect(native.plugin.install).not.toHaveBeenCalled();
  });

  it('passes the release size so a short download is refused natively', async () => {
    const hook = await withUpdate();
    await startDownload(hook);
    expect(native.plugin.download).toHaveBeenCalledWith(expect.objectContaining({ size: SIZE, sha256: SHA }));
  });

  it('shows no number when the size is unknown', () => {
    expect(displayPercent(UpdateStatus.DOWNLOADING, -1)).toBe(-1);
    expect(displayPercent(UpdateStatus.DOWNLOADING, undefined)).toBe(-1);
  });
});

describe('installing', () => {
  async function readyHook() {
    const hook = await withUpdate();
    const answer = await startDownload(hook);
    await act(async () => answer.resolve({ path: '/cache/updates/locus-latest.apk' }));
    return hook;
  }

  it('hands the checked file to Android on Install, and stays on Ready with its button', async () => {
    const hook = await readyHook();
    await act(async () => hook.result.current.installUpdate());
    expect(native.plugin.install).toHaveBeenCalledWith({ path: '/cache/updates/locus-latest.apk' });
    expect(hook.result.current.status).toBe(UpdateStatus.READY);

    // The installer was cancelled: tapping again installs the same file, no new download.
    await act(async () => hook.result.current.installUpdate());
    expect(native.plugin.install).toHaveBeenCalledTimes(2);
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
  });

  it('asks for the install permission if it is missing, then installs on return without downloading again', async () => {
    const hook = await readyHook();
    native.plugin.getInstallPermissionStatus.mockImplementation(async () => ({ granted: false }));
    await act(async () => hook.result.current.installUpdate());
    expect(hook.result.current.status).toBe(UpdateStatus.PERMISSION_REQUIRED);
    expect(native.plugin.install).not.toHaveBeenCalled();

    native.plugin.getInstallPermissionStatus.mockImplementation(async () => ({ granted: true }));
    await act(async () => native.resume());
    expect(native.plugin.install).toHaveBeenCalledTimes(1);
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
  });

  it('treats a native PERMISSION_DENIED the same way', async () => {
    const hook = await readyHook();
    native.plugin.install.mockImplementationOnce(async () => {
      throw nativeError('PERMISSION_DENIED');
    });
    await act(async () => hook.result.current.installUpdate());
    expect(hook.result.current.status).toBe(UpdateStatus.PERMISSION_REQUIRED);
  });

  it('shows an installer that would not open as a failure with Try again', async () => {
    const hook = await readyHook();
    native.plugin.install.mockImplementationOnce(async () => {
      throw nativeError('INSTALL_FAILED');
    });
    await act(async () => hook.result.current.installUpdate());
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(hook.result.current.error).toMatchObject({ code: 'INSTALL_FAILED', during: 'download' });
  });

  it('asks for the permission before downloading when it is missing, and downloads on return', async () => {
    native.plugin.getInstallPermissionStatus.mockImplementation(async () => ({ granted: false }));
    const hook = await withUpdate();
    await act(async () => hook.result.current.startDownload());
    expect(hook.result.current.status).toBe(UpdateStatus.PERMISSION_REQUIRED);
    expect(native.plugin.download).not.toHaveBeenCalled();

    native.plugin.getInstallPermissionStatus.mockImplementation(async () => ({ granted: true }));
    native.plugin.download.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => native.resume());
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe(UpdateStatus.DOWNLOADING);
  });
});

describe('fails closed', () => {
  it.each(['CHECKSUM_MISMATCH', 'SIZE_MISMATCH'])('%s ends in a failure, never an install', async (code) => {
    const hook = await withUpdate();
    const answer = await startDownload(hook);
    await act(async () => answer.reject(nativeError(code)));
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(hook.result.current.error.code).toBe(code);

    // Nothing verified is kept: Install would download afresh, not install the bad file.
    native.plugin.download.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => hook.result.current.installUpdate());
    expect(native.plugin.install).not.toHaveBeenCalled();
  });
});

describe('stall timeout', () => {
  it('gives up after the stall time with no progress, cancels, and starts clean on retry', async () => {
    vi.useFakeTimers();
    const hook = await withUpdate({ stallTimeoutMs: 1000 });
    const first = await startDownload(hook);

    await act(async () => vi.advanceTimersByTime(999));
    expect(hook.result.current.status).toBe(UpdateStatus.DOWNLOADING);
    // Progress proves it is alive and restarts the countdown.
    await progress(SIZE / 4);
    await act(async () => vi.advanceTimersByTime(999));
    expect(hook.result.current.status).toBe(UpdateStatus.DOWNLOADING);

    await act(async () => vi.advanceTimersByTime(1));
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(hook.result.current.error).toMatchObject({ code: 'STALLED', during: 'download' });
    // Native cancel deletes the partial file.
    expect(native.plugin.cancelDownload).toHaveBeenCalledTimes(1);

    // The abandoned attempt answering late changes nothing.
    await progress(SIZE / 2);
    await act(async () => first.resolve({ path: '/cache/updates/locus-latest.apk' }));
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);

    // Try again starts from nothing.
    await startDownload(hook);
    expect(hook.result.current.status).toBe(UpdateStatus.DOWNLOADING);
    expect(hook.result.current.error).toBeNull();
    expect(shown(hook)).toBe(-1);
    expect(native.plugin.download).toHaveBeenCalledTimes(2);
  });

  it('also covers the wait for the checks after the last byte', async () => {
    vi.useFakeTimers();
    const hook = await withUpdate({ stallTimeoutMs: 1000 });
    await startDownload(hook);
    await progress(SIZE, 'verifying');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(hook.result.current.error.code).toBe('STALLED');
  });

  it('defaults to 30 s and no silent retries', async () => {
    const { APK_DOWNLOAD_STALL_TIMEOUT_MS, APK_DOWNLOAD_MAX_RETRIES_AUTO } = await import('../src/hooks/useAppUpdate.js');
    expect(APK_DOWNLOAD_STALL_TIMEOUT_MS).toBe(30000);
    expect(APK_DOWNLOAD_MAX_RETRIES_AUTO).toBe(0);
  });
});

describe('retries', () => {
  it('a broken download shows the failure at once by default', async () => {
    const hook = await withUpdate();
    const answer = await startDownload(hook);
    await act(async () => answer.reject(nativeError('IO_ERROR')));
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
  });

  it('retries silently up to the configured count, then shows the failure', async () => {
    const hook = await withUpdate({ maxAutoRetries: 1 });
    const first = await startDownload(hook);
    const second = deferred();
    native.plugin.download.mockImplementationOnce(() => second.promise);

    await act(async () => first.reject(nativeError('IO_ERROR')));
    expect(native.plugin.download).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe(UpdateStatus.DOWNLOADING);

    await act(async () => second.reject(nativeError('IO_ERROR')));
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(native.plugin.download).toHaveBeenCalledTimes(2);
  });

  it('never silently retries a damaged file', async () => {
    const hook = await withUpdate({ maxAutoRetries: 3 });
    const answer = await startDownload(hook);
    await act(async () => answer.reject(nativeError('CHECKSUM_MISMATCH')));
    expect(hook.result.current.status).toBe(UpdateStatus.ERROR);
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
  });
});
