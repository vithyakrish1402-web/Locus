// The launch lookup (src/utils/releasesLookup.js) reads the update index first, through
// Capacitor's native HTTP plugin (GitHub's download links carry no CORS headers, so the
// WebView's own fetch cannot read it). It uses the file only when every check passes; on any
// failure it asks the API listing exactly as js-1.1.23 did.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: true, plugin: true, get: null }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.platform,
    isPluginAvailable: (name) => name === 'CapacitorHttp' && native.plugin,
  },
  CapacitorHttp: { get: (...args) => native.get(...args) },
}));

const { getReleases, RELEASES_API, UPDATE_INDEX_TIMEOUT_MS, __resetReleasesLookup } = await import('../src/utils/releasesLookup.js');

const REPO = 'vithyakrish1402-web/Locus-Release';
const SHA = 'a'.repeat(64);
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-13T12:00:00Z');
const link = (tag, name) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
const apk = (version, extra = {}) => ({
  tag_name: `v${version}`,
  prerelease: false,
  body: `SHA256: ${SHA}`,
  assets: [{ name: 'locus-latest.apk', browser_download_url: link(`v${version}`, 'locus-latest.apk'), size: 5036092 }],
  ...extra,
});
const bundle = (version) => ({
  tag_name: `js-${version}`,
  prerelease: false,
  body: `MIN_NATIVE: 1.1.21\nSHA256: ${SHA}`,
  assets: [{ name: 'locus-bundle.zip', browser_download_url: link(`js-${version}`, 'locus-bundle.zip'), size: 1048576 }],
});
const FILE_RELEASES = [bundle('1.1.24'), apk('1.1.21')];
const file = (overrides = {}) => ({ formatVersion: 1, generatedAt: new Date(NOW - HOUR).toISOString(), releases: FILE_RELEASES, ...overrides });
// What the native plugin resolves with: GitHub serves the file as application/octet-stream, so
// it arrives as text.
const served = (data, status = 200) => ({ status, headers: {}, url: 'https://release-assets.githubusercontent.com/x', data: typeof data === 'string' ? data : JSON.stringify(data) });

// The API listing, deliberately different from the file so each test can tell who answered.
const API_LISTING = [{ tag_name: 'js-1.1.23', draft: false, prerelease: false, body: '', assets: [] }];
const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null });
const apiOk = () => ({ ok: true, status: 200, headers: headers({}), json: async () => API_LISTING });

let warn;
beforeEach(() => {
  __resetReleasesLookup();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  native.platform = true;
  native.plugin = true;
  native.get = vi.fn(async () => served(file()));
  globalThis.fetch = vi.fn(async () => apiOk());
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
});

describe('a launch served by the update index', () => {
  it('reads the file through the native plugin, and never asks the API', async () => {
    expect(await getReleases()).toEqual(FILE_RELEASES);
    expect(native.get).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks for a fresh copy, marked with the current time', async () => {
    await getReleases();
    const [options] = native.get.mock.calls[0];
    expect(options.url).toBe(`https://github.com/${REPO}/releases/download/update-index/update-index.json?t=${NOW}`);
    expect(options.responseType).toBe('text');
  });

  it('one read per launch: callers at the same time share it, later callers reuse it', async () => {
    const [a, b] = await Promise.all([getReleases(), getReleases()]);
    expect(b).toBe(a);
    expect(await getReleases()).toBe(a);
    expect(native.get).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('Check for updates reads the file again, with a new fresh-copy marker', async () => {
    await getReleases();
    vi.setSystemTime(NOW + 5000);
    await getReleases({ fresh: true });
    expect(native.get).toHaveBeenCalledTimes(2);
    expect(native.get.mock.calls[1][0].url).toMatch(new RegExp(`\\?t=${NOW + 5000}$`));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a file the plugin already parsed is read the same', async () => {
    native.get = vi.fn(async () => ({ status: 200, headers: {}, data: file() }));
    expect(await getReleases()).toEqual(FILE_RELEASES);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('every way the file can fail lands on the API listing, as in js-1.1.23', () => {
  const fallsBack = async ({ reason, read = 1 } = {}) => {
    expect(await getReleases()).toEqual(API_LISTING);
    expect(native.get).toHaveBeenCalledTimes(read);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toBe(RELEASES_API);
    if (reason) expect(warn).toHaveBeenCalledWith(expect.stringContaining('Update index not used'), reason);
  };

  it('no native plugin (a browser preview): straight to the API, the file never read', async () => {
    native.platform = false;
    await fallsBack({ read: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('native platform but the HTTP plugin unavailable', async () => {
    native.plugin = false;
    await fallsBack({ read: 0 });
  });

  it('the file is missing', async () => {
    native.get = vi.fn(async () => served('Not Found', 404));
    await fallsBack({ reason: 'HTTP_404' });
  });

  it('the download fails', async () => {
    native.get = vi.fn(async () => {
      throw new Error('Unable to resolve host "github.com"');
    });
    await fallsBack({ reason: 'Unable to resolve host "github.com"' });
  });

  it('the file is not JSON', async () => {
    native.get = vi.fn(async () => served('<html>Something went wrong</html>'));
    await fallsBack({ reason: 'MALFORMED' });
  });

  it('the file is JSON but not an index', async () => {
    native.get = vi.fn(async () => served([]));
    await fallsBack({ reason: 'MALFORMED' });
  });

  it('a format version it does not know', async () => {
    native.get = vi.fn(async () => served(file({ formatVersion: 2 })));
    await fallsBack({ reason: 'UNKNOWN_FORMAT' });
  });

  it('older than 30 days', async () => {
    native.get = vi.fn(async () => served(file({ generatedAt: new Date(NOW - 721 * HOUR).toISOString() })));
    await fallsBack({ reason: 'TOO_OLD' });
  });

  it("dated in the future (the phone's clock is wrong)", async () => {
    native.get = vi.fn(async () => served(file({ generatedAt: new Date(NOW + 25 * HOUR).toISOString() })));
    await fallsBack({ reason: 'FUTURE_DATED' });
  });

  it("a download link outside this project's releases", async () => {
    const foreign = { ...apk('1.1.21'), assets: [{ name: 'locus-latest.apk', browser_download_url: 'https://evil.example/locus-latest.apk', size: 1 }] };
    native.get = vi.fn(async () => served(file({ releases: [bundle('1.1.24'), foreign] })));
    await fallsBack({ reason: 'FOREIGN_LINK' });
  });

  it('no usable app release', async () => {
    native.get = vi.fn(async () => served(file({ releases: [bundle('1.1.24')] })));
    await fallsBack({ reason: 'NO_USABLE_APK' });
  });

  it('no usable JS release', async () => {
    native.get = vi.fn(async () => served(file({ releases: [apk('1.1.21')] })));
    await fallsBack({ reason: 'NO_USABLE_BUNDLE' });
  });

  it(`no answer within ${UPDATE_INDEX_TIMEOUT_MS / 1000} s`, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    native.get = vi.fn(() => new Promise(() => {}));
    const answer = getReleases();
    await vi.advanceTimersByTimeAsync(UPDATE_INDEX_TIMEOUT_MS - 1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual(API_LISTING);
    expect(warn).toHaveBeenCalledWith(expect.any(String), 'TIMEOUT');
  });

  it('when the API then refuses too, the busy refusal and its refill time reach the caller unchanged', async () => {
    native.get = vi.fn(async () => served('Not Found', 404));
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791868500' }),
      json: async () => ({}),
    }));
    await expect(getReleases()).rejects.toMatchObject({ code: 'RATE_LIMITED', resetAt: new Date(1791868500 * 1000) });
  });

  it('a failed launch is not reused: the next caller reads the file again', async () => {
    native.get = vi.fn().mockResolvedValueOnce(served('Not Found', 404)).mockResolvedValue(served(file()));
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, headers: headers({}), json: async () => ({}) }));
    await expect(getReleases()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(await getReleases()).toEqual(FILE_RELEASES);
    expect(native.get).toHaveBeenCalledTimes(2);
  });
});
