// @vitest-environment jsdom
//
// The update strip while a JS bundle downloads. On the phone the plugin can sit a minute
// before its first byte, and closing the app kills the download - with nothing on screen
// that looked like no update at all, and each reopen started it over. Now the strip shows
// the download from the moment it starts, with its progress, and says to keep LOCUS open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';

const updater = vi.hoisted(() => ({
  listeners: new Map(),
  download: null,
  addListener: null,
  remove: null,
  set: null,
}));

vi.mock('../src/utils/liveUpdater', () => ({
  isLiveUpdaterAvailable: () => true,
  notifyAppReady: () => {},
  CapacitorUpdater: {
    current: async () => ({ bundle: { version: '1.1.2' } }),
    addListener: (...args) => updater.addListener(...args),
    download: (...args) => updater.download(...args),
    set: (...args) => updater.set(...args),
  },
}));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.1.0' }) } }));

const { useLiveUpdate, LiveUpdateStatus, __resetLiveColdStartThrottle } = await import('../src/hooks/useLiveUpdate.js');
const { default: LiveUpdateToast } = await import('../src/components/LiveUpdateToast.jsx');

const SHA = 'f'.repeat(64);
const RELEASES = [
  {
    tag_name: 'js-1.1.3',
    draft: false,
    prerelease: false,
    body: `notes\nMIN_NATIVE: 1.1.0\nSHA256: ${SHA}`,
    assets: [{ name: 'locus-bundle.zip', browser_download_url: 'https://example.test/js-1.1.3.zip', size: 600000 }],
  },
];

let finishDownload;
let failDownload;

beforeEach(() => {
  __resetLiveColdStartThrottle();
  updater.listeners = new Map();
  updater.remove = vi.fn();
  updater.addListener = vi.fn(async (event, fn) => {
    updater.listeners.set(event, fn);
    return { remove: updater.remove };
  });
  updater.download = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        finishDownload = () => resolve({ id: 'b1', version: '1.1.3' });
        failDownload = (e) => reject(e);
      })
  );
  updater.set = vi.fn(async () => {});
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RELEASES }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const progress = (percent) => act(() => updater.listeners.get('download')?.({ percent, bundle: {} }));
const settle = () => act(async () => {});

describe('useLiveUpdate while downloading', () => {
  it('is visible from the moment the download starts, before any progress', async () => {
    const { result } = renderHook(() => useLiveUpdate());
    await settle();
    expect(result.current.status).toBe(LiveUpdateStatus.DOWNLOADING);
    expect(result.current.visible).toBe(true);
    expect(result.current.download).toMatchObject({ percent: null });
    expect(Number.isFinite(result.current.download.startedAt)).toBe(true);
  });

  it("follows the plugin's progress, clamped, then is READY with the listener removed", async () => {
    const { result } = renderHook(() => useLiveUpdate());
    await settle();
    progress(42.4);
    expect(result.current.download.percent).toBe(42);
    progress(140);
    expect(result.current.download.percent).toBe(100);
    progress(undefined);
    expect(result.current.download.percent).toBe(100);

    await act(async () => finishDownload());
    expect(result.current.status).toBe(LiveUpdateStatus.READY);
    expect(updater.remove).toHaveBeenCalledTimes(1);
  });

  it('dismissing the download notice does not also hide the RESTART that follows', async () => {
    const { result } = renderHook(() => useLiveUpdate());
    await settle();
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);
    await act(async () => finishDownload());
    expect(result.current.visible).toBe(true);
  });

  it('shows a failed download, with the listener removed', async () => {
    const { result } = renderHook(() => useLiveUpdate());
    await settle();
    await act(async () => failDownload(new Error('checksum mismatch')));
    expect(result.current.status).toBe(LiveUpdateStatus.ERROR);
    expect(result.current.visible).toBe(true);
    expect(result.current.error.message).toBe('checksum mismatch');
    expect(updater.remove).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the check fails before finding anything', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    });
    const { result } = renderHook(() => useLiveUpdate());
    await settle();
    expect(result.current.status).toBe(LiveUpdateStatus.ERROR);
    expect(result.current.visible).toBe(false);
  });

  it('still downloads when progress cannot be listened to', async () => {
    updater.addListener = vi.fn(async () => {
      throw new Error('not implemented');
    });
    const { result } = renderHook(() => useLiveUpdate());
    await settle();
    expect(result.current.status).toBe(LiveUpdateStatus.DOWNLOADING);
    await act(async () => finishDownload());
    expect(result.current.status).toBe(LiveUpdateStatus.READY);
  });
});

describe('the strip', () => {
  const live = (over) => ({
    visible: true,
    status: LiveUpdateStatus.DOWNLOADING,
    manifest: { version: '1.1.3', minNative: '1.1.0' },
    download: { startedAt: Date.now(), percent: null },
    error: null,
    applyNow: vi.fn(),
    dismiss: vi.fn(),
    ...over,
  });
  const strip = () => screen.getByRole('status');

  it('while waiting for the first byte: UPDATING, PREPARING, a moving bar, and keep LOCUS open', () => {
    vi.useFakeTimers();
    render(<LiveUpdateToast live={live({ download: { startedAt: Date.now(), percent: null } })} />);
    expect(strip().textContent).toMatch(/UPDATING/);
    expect(strip().textContent).toMatch(/PREPARING · 0S/);
    expect(strip().textContent).toMatch(/Keep LOCUS open/);
    expect(screen.getByTestId('download-sweep')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
    act(() => vi.advanceTimersByTime(12_000));
    expect(strip().textContent).toMatch(/PREPARING · 12S/);
  });

  it('with progress: the percent, and a bar filled to it', () => {
    render(<LiveUpdateToast live={live({ download: { startedAt: Date.now(), percent: 60 } })} />);
    expect(strip().textContent).toMatch(/60%/);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(bar.firstChild.style.width).toBe('60%');
    expect(screen.queryByTestId('download-sweep')).toBeNull();
  });

  it('a failed download says what happened and that it will retry, with no RESTART', () => {
    render(<LiveUpdateToast live={live({ status: LiveUpdateStatus.ERROR, error: { message: 'checksum mismatch' } })} />);
    expect(strip().textContent).toMatch(/UPDATE FAILED/);
    expect(strip().textContent).toMatch(/1\.1\.3 didn.t install \(checksum mismatch\)/);
    expect(strip().textContent).toMatch(/try again next time you open it/);
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
  });

  it('RESTART answers at once, and cannot be tapped twice', () => {
    const applyNow = vi.fn();
    render(<LiveUpdateToast live={live({ status: LiveUpdateStatus.READY, download: null, applyNow })} />);
    const button = screen.getByRole('button', { name: 'Restart' });
    fireEvent.click(button);
    expect(applyNow).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Restarting...');
    expect(button.disabled).toBe(true);
  });
});
