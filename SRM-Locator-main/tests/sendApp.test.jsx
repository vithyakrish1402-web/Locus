// @vitest-environment jsdom
//
// SYS_CONFIG -> SEND_APP: download or copy the installer for the version on this phone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const platform = vi.hoisted(() => ({ native: true, version: '1.1.0' }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native } }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: platform.version }) } }));
const clip = vi.hoisted(() => ({ copyText: null }));
vi.mock('../src/utils/clipboard', () => ({ copyText: (...a) => clip.copyText(...a) }));

const { default: SendApp } = await import('../src/components/SendApp.jsx');
const { selectInstallerRelease } = await import('../src/utils/updateManifest.js');

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

beforeEach(() => {
  platform.native = true;
  platform.version = '1.1.0';
  clip.copyText = vi.fn(async () => true);
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RELEASES }));
});
afterEach(cleanup);

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
  it('names what it will send, and DOWNLOAD APK hands that link to the browser', async () => {
    platform.version = '1.0.0';
    const openUrl = vi.fn();
    render(<SendApp openUrl={openUrl} />);
    expect(await screen.findByText(/LOCUS v1\.0\.0 · 4\.8 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /DOWNLOAD APK/ }));
    expect(openUrl).toHaveBeenCalledWith('https://example.test/v1.0.0/locus-latest.apk');
  });

  it('off the phone, sends the newest APK', async () => {
    platform.native = false;
    render(<SendApp openUrl={vi.fn()} />);
    expect(await screen.findByText(/LOCUS v1\.1\.0/)).toBeTruthy();
  });

  it('COPY LINK copies the installer link and says so', async () => {
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS v1\.1\.0/);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /COPY LINK/ })));
    expect(clip.copyText).toHaveBeenCalledWith('https://example.test/v1.1.0/locus-latest.apk');
    expect(screen.getByRole('button', { name: /COPIED/ })).toBeTruthy();
  });

  it('says when the copy failed', async () => {
    clip.copyText = vi.fn(async () => false);
    render(<SendApp openUrl={vi.fn()} />);
    await screen.findByText(/LOCUS v1\.1\.0/);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /COPY LINK/ })));
    expect(screen.getByRole('button', { name: /COPY FAILED/ })).toBeTruthy();
  });

  it('keeps both buttons off until the installer is found', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    render(<SendApp openUrl={vi.fn()} />);
    expect(screen.getByText(/Finding the installer/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /DOWNLOAD APK/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /COPY LINK/ }).disabled).toBe(true);
  });

  it('says why it failed, and TRY AGAIN looks again', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => RELEASES });
    render(<SendApp openUrl={vi.fn()} />);
    expect(await screen.findByText(/GitHub returned HTTP 403/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
    await waitFor(() => expect(screen.getByText(/LOCUS v1\.1\.0/)).toBeTruthy());
  });
});
