// @vitest-environment jsdom
//
// Settings -> Send LOCUS to someone: send or copy the installer for the version on this phone.
// Sending: LOCUS downloads and checks the file, then opens Android's share sheet. An app
// whose native side cannot share (v1.1.0) and the web build hand the link to the browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND_APP } from '../src/copy/settings.js';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const platform = vi.hoisted(() => ({ native: true, version: '1.1.0' }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: platform.version }) } }));
const clip = vi.hoisted(() => ({ copyText: null }));
vi.mock('../src/utils/clipboard', () => ({ copyText: (...a) => clip.copyText(...a) }));
const native = vi.hoisted(() => ({ canShare: false, listeners: {}, plugin: null }));
vi.mock('../src/utils/locusUpdater', () => {
  native.plugin = {
    download: vi.fn(),
    shareFile: vi.fn(async () => {}),
    cancelDownload: vi.fn(async () => {}),
    addListener: vi.fn(),
  };
  return { LocusUpdater: native.plugin, canShareInstaller: () => native.canShare, isUpdaterAvailable: () => native.canShare };
});

const { default: SendApp } = await import('../src/components/SendApp.jsx');
const { selectInstallerRelease } = await import('../src/utils/updateManifest.js');
const { __resetReleasesLookup } = await import('../src/utils/releasesLookup.js');

const SHA = 'a'.repeat(64);
const apk = (tag, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  body: `SHA256: ${SHA}`,
  assets: [{ name: 'locus-latest.apk', browser_download_url: `https://example.test/${tag}/locus-latest.apk`, size: 5036092 }],
  ...extra,
});
const RELEASES = [{ tag_name: 'js-1.1.3', draft: false, prerelease: false, body: '', assets: [] }, apk('v1.1.0'), apk('v1.0.0')];

beforeEach(async () => {
  __resetReleasesLookup();
  native.canShare = false;
  // The mocked bridge is built when something first imports it.
  if (!native.plugin) await import('../src/utils/locusUpdater');
  for (const fn of Object.values(native.plugin)) fn.mockReset();
  native.plugin.shareFile.mockImplementation(async () => {});
  native.plugin.cancelDownload.mockImplementation(async () => {});
  native.plugin.addListener.mockImplementation(async (name, fn) => {
    native.listeners[name] = fn;
    return { remove() {} };
  });
  platform.native = true;
  platform.version = '1.1.0';
  clip.copyText = vi.fn(async () => true);
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RELEASES }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('selectInstallerRelease', () => {
  it('picks the release matching the installed version', () => {
    expect(selectInstallerRelease(RELEASES, '1.0.0').apkUrl).toBe('https://example.test/v1.0.0/locus-latest.apk');
  });

  it('falls back to the newest APK for an unknown, unreleased or unreadable version', () => {
    for (const v of [null, '9.9.9', 'debug']) {
      expect(selectInstallerRelease(RELEASES, v).version).toBe('1.1.0');
    }
  });

  it('skips a matching release with no usable APK, and bundle releases', () => {
    const broken = [apk('v1.1.0', { assets: [] }), apk('v1.0.0')];
    expect(selectInstallerRelease(broken, '1.1.0').version).toBe('1.0.0');
    expect(selectInstallerRelease([RELEASES[0]], '1.1.3')).toBeNull();
    expect(selectInstallerRelease(null, '1.1.0')).toBeNull();
  });
});

describe('SendApp', () => {
  it('on an app that cannot share the file, names what it will send, and DOWNLOAD APK hands that link to the browser', async () => {
    platform.version = '1.0.0';
    const openUrl = vi.fn();
    render(<SendApp openUrl={openUrl} />);
    expect(await screen.findByText(/LOCUS 1\.0\.0 · 4\.8 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SEND_APP.download }));
    expect(openUrl).toHaveBeenCalledWith('https://example.test/v1.0.0/locus-latest.apk');
  });

  it('off the phone, sends the newest APK', async () => {
    platform.native = false;
    render(<SendApp openUrl={vi.fn()} />);
    expect(await screen.findByText(/LOCUS 1\.1\.0/)).toBeTruthy();
  });

  it('COPY LINK copies the installer link and says so', async () => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: SEND_APP.copyLink })));
    expect(clip.copyText).toHaveBeenCalledWith('https://example.test/v1.1.0/locus-latest.apk');
    expect(screen.getByRole('button', { name: SEND_APP.copied })).toBeTruthy();
  });

  it('says when the copy failed', async () => {
    clip.copyText = vi.fn(async () => false);
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: SEND_APP.copyLink })));
    expect(screen.getByRole('button', { name: SEND_APP.copyFailed })).toBeTruthy();
  });

  it('keeps both buttons off until the installer is found', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    render(<SendApp openUrl={vi.fn()} />);
    expect(screen.getByText(/Finding the installer/)).toBeTruthy();
    expect(screen.getByRole('button', { name: SEND_APP.download }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: SEND_APP.copyLink }).disabled).toBe(true);
  });

  it('says why it failed, and TRY AGAIN looks again', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => RELEASES });
    render(<SendApp openUrl={vi.fn()} />);
    expect(await screen.findByText(SEND_APP.error('GitHub returned HTTP 500'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SEND_APP.tryAgain }));
    await waitFor(() => expect(screen.getByText(/LOCUS 1\.1\.0/)).toBeTruthy());
  });

  describe('when GitHub refuses (its hourly limit for this network is used up)', () => {
    const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null });
    const refused = (h = {}) => ({ ok: false, status: 403, headers: headers(h), json: async () => ({}) });
    const clock = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    it('says the server is busy and when to try again, never "HTTP 403"', async () => {
      const resetAt = new Date(Math.ceil((Date.now() + 20 * 60 * 1000) / 1000) * 1000);
      globalThis.fetch = vi.fn(async () => refused({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetAt.getTime() / 1000) }));
      render(<SendApp openUrl={vi.fn()} />);
      expect(await screen.findByText(SEND_APP.busy(clock(resetAt)))).toBeTruthy();
      expect(SEND_APP.busy(clock(resetAt))).toBe(`The download server is busy. Try again after ${clock(resetAt)}.`);
      expect(document.body.textContent).not.toMatch(/HTTP|403/);
    });

    it('without a refill time, or with one already past or over an hour off, says "in a few minutes"', async () => {
      for (const h of [{}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) - 60) }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3 * 3600) }]) {
        __resetReleasesLookup();
        globalThis.fetch = vi.fn(async () => refused(h));
        render(<SendApp openUrl={vi.fn()} />);
        expect(await screen.findByText('The download server is busy. Try again in a few minutes.')).toBeTruthy();
        cleanup();
      }
    });

    it('TRY AGAIN asks GitHub again and finds the installer once it answers', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(refused()).mockResolvedValue({ ok: true, json: async () => RELEASES });
      render(<SendApp openUrl={vi.fn()} />);
      await screen.findByText(SEND_APP.busy(null));
      fireEvent.click(screen.getByRole('button', { name: SEND_APP.tryAgain }));
      await waitFor(() => expect(screen.getByText(/LOCUS 1\.1\.0/)).toBeTruthy());
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('opened again in the same launch, reuses the answer instead of asking GitHub again', async () => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    cleanup();
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('SendApp sending the file itself', () => {
  const SIZE = 5036092;
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
    act(async () => native.listeners.downloadProgress({ stage, loaded, total: SIZE, percent: Math.floor((loaded * 100) / SIZE) }));

  async function tapSend() {
    const answer = deferred();
    native.plugin.download.mockImplementationOnce(() => answer.promise);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Send installer|Try again/ })));
    return answer;
  }

  beforeEach(() => {
    native.canShare = true;
  });

  it('never hands the link to the browser', async () => {
    const openUrl = vi.fn();
    render(<SendApp openUrl={openUrl} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    expect(screen.queryByRole('button', { name: SEND_APP.download })).toBeNull();
    await tapSend();
    expect(openUrl).not.toHaveBeenCalled();
    expect(native.plugin.download).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/v1.1.0/locus-latest.apk',
      sha256: SHA,
      size: SIZE,
      fileName: 'LOCUS-1.1.0.apk',
    }));
  });

  it('downloads, checks, then opens the share sheet, never showing 100% before the check', async () => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    const answer = await tapSend();
    expect(screen.getByRole('button', { name: SEND_APP.send }).disabled).toBe(true);

    await progress(SIZE / 2);
    expect(screen.getByText(SEND_APP.downloading(50))).toBeTruthy();
    await progress(SIZE);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('99');
    expect(screen.queryByText(/100%/)).toBeNull();

    await progress(SIZE, 'verifying');
    expect(screen.getByText(SEND_APP.checking)).toBeTruthy();
    expect(native.plugin.shareFile).not.toHaveBeenCalled();

    await act(async () => answer.resolve({ path: '/cache/updates/LOCUS-1.1.0.apk' }));
    expect(native.plugin.shareFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/cache/updates/LOCUS-1.1.0.apk' }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByText(SEND_APP.sent)).toBeTruthy();
    expect(screen.getByText(SEND_APP.theirPhone)).toBeTruthy();

    // Sending again reuses the checked file.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: SEND_APP.send })));
    expect(native.plugin.shareFile).toHaveBeenCalledTimes(2);
    expect(native.plugin.download).toHaveBeenCalledTimes(1);
  });

  it('shows no number when the size is unknown', async () => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    await tapSend();
    await act(async () => native.listeners.downloadProgress({ stage: 'downloading', loaded: 1000, total: -1, percent: -1 }));
    expect(screen.getByText('Downloading installer…')).toBeTruthy();
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
  });

  it.each(['CHECKSUM_MISMATCH', 'SIZE_MISMATCH'])('%s: says the file looks damaged and never shares it', async (code) => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    const answer = await tapSend();
    await act(async () => answer.reject(nativeError(code)));
    expect(screen.getByText(SEND_APP.failed.damaged)).toBeTruthy();
    expect(native.plugin.shareFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: SEND_APP.tryAgain })).toBeTruthy();
  });

  it('a broken download says it did not finish, and Try again starts a fresh one', async () => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    const answer = await tapSend();
    await act(async () => answer.reject(nativeError('IO_ERROR')));
    expect(screen.getByText(SEND_APP.failed.didntFinish)).toBeTruthy();
    await tapSend();
    expect(native.plugin.download).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(SEND_APP.failed.didntFinish)).toBeNull();
  });

  it('gives up after 30 s with no progress, cancels (deleting the partial file), and offers Try again', async () => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const first = await tapSend();
    await act(async () => vi.advanceTimersByTime(29_999));
    expect(screen.queryByText(SEND_APP.failed.didntFinish)).toBeNull();
    await progress(SIZE / 4);
    await act(async () => vi.advanceTimersByTime(29_999));
    expect(screen.queryByText(SEND_APP.failed.didntFinish)).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByText(SEND_APP.failed.didntFinish)).toBeTruthy();
    expect(native.plugin.cancelDownload).toHaveBeenCalledTimes(1);

    // The abandoned download answering late shares nothing.
    await act(async () => first.resolve({ path: '/cache/updates/LOCUS-1.1.0.apk' }));
    expect(native.plugin.shareFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: SEND_APP.tryAgain })).toBeTruthy();
  });

  it('says so when the share menu would not open, and Try again downloads afresh', async () => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS 1\.1\.0/);
    native.plugin.shareFile.mockImplementationOnce(async () => {
      throw nativeError('SHARE_FAILED');
    });
    const answer = await tapSend();
    await act(async () => answer.resolve({ path: '/cache/updates/LOCUS-1.1.0.apk' }));
    expect(screen.getByText(SEND_APP.failed.noShare)).toBeTruthy();
    await tapSend();
    expect(native.plugin.download).toHaveBeenCalledTimes(2);
  });
});
