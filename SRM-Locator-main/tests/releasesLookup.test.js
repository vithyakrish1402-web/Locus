// @vitest-environment jsdom
//
// The one lookup of GitHub's releases list that the APK update check, the live-update check
// and Send LOCUS share (src/utils/releasesLookup.js). GitHub allows 60 anonymous requests an
// hour per public address, shared by everyone on the network (campus Wi-Fi), so a launch
// asks once, and asks "has anything changed?" with the last list's ETag: a 304 is free.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReleases, RELEASES_API, rateLimitResetAt, slimReleases, __resetReleasesLookup } from '../src/utils/releasesLookup.js';
import { selectInstallerRelease, selectLatestApkRelease } from '../src/utils/updateManifest.js';
import { selectLatestBundleRelease } from '../src/utils/liveUpdateManifest.js';

const SHA = 'c'.repeat(64);
const user = { login: 'someone', id: 1, node_id: 'U_1', avatar_url: 'https://example.test/a.png', type: 'User', site_admin: false };
// A release as GitHub sends it: every field, not only the few LOCUS reads.
const full = (tag, assetName) => ({
  url: `https://api.github.com/repos/o/r/releases/${tag}`,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  id: tag.length,
  author: user,
  node_id: `RE_${tag}`,
  tag_name: tag,
  target_commitish: 'main',
  name: `LOCUS ${tag}`,
  draft: false,
  prerelease: false,
  created_at: '2026-10-10T17:55:15Z',
  published_at: '2026-10-10T17:55:15Z',
  body: `Notes for ${tag}.\n\nMIN_NATIVE: 1.1.0\nSHA256: ${SHA}`,
  assets: [{
    url: `https://api.github.com/repos/o/r/releases/assets/${tag}`,
    id: 7,
    node_id: 'RA_1',
    name: assetName,
    label: '',
    uploader: user,
    content_type: 'application/zip',
    state: 'uploaded',
    size: 795000,
    download_count: 12,
    created_at: '2026-10-10T17:55:15Z',
    updated_at: '2026-10-10T17:55:16Z',
    browser_download_url: `https://github.com/o/r/releases/download/${tag}/${assetName}`,
  }],
  tarball_url: `https://api.github.com/repos/o/r/tarball/${tag}`,
  zipball_url: `https://api.github.com/repos/o/r/zipball/${tag}`,
  reactions: { total_count: 0 },
});
const LISTING = [
  full('js-1.1.22', 'locus-bundle.zip'),
  full('v1.1.21', 'locus-latest.apk'),
  full('js-1.1.20', 'locus-bundle.zip'),
  full('v1.1.0', 'locus-latest.apk'),
];

const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null });
const ok = (body, etag) => ({ ok: true, status: 200, headers: headers(etag ? { etag } : {}), json: async () => body });
const notModified = () => ({ ok: false, status: 304, headers: headers({}), json: async () => { throw new Error('a 304 has no body'); } });
const refused = (status, h = {}) => ({ ok: false, status, headers: headers(h), json: async () => ({ message: 'API rate limit exceeded' }) });
const sentHeaders = (call) => globalThis.fetch.mock.calls[call][1].headers;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  __resetReleasesLookup();
  globalThis.fetch = vi.fn(async () => ok(LISTING, 'W/"etag-1"'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('one lookup per launch', () => {
  it('callers at the same time share one request, and later callers reuse its answer', async () => {
    const answer = deferred();
    globalThis.fetch = vi.fn(() => answer.promise);
    const first = getReleases();
    const second = getReleases();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    answer.resolve(ok(LISTING, 'W/"etag-1"'));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(slimReleases(LISTING));
    expect(b).toBe(a);
    expect(await getReleases()).toBe(a);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toBe(RELEASES_API);
  });

  it('a manual check asks GitHub again', async () => {
    await getReleases();
    await getReleases({ revalidate: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('a manual check while a request is out shares it', async () => {
    const answer = deferred();
    globalThis.fetch = vi.fn(() => answer.promise);
    const automatic = getReleases();
    const manual = getReleases({ revalidate: true });
    answer.resolve(ok(LISTING));
    await Promise.all([automatic, manual]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a failed lookup is not reused: the next caller asks again', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(ok(LISTING));
    await expect(getReleases()).rejects.toThrow('Failed to fetch');
    expect(await getReleases()).toEqual(slimReleases(LISTING));
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('an answer that is not a list is passed on but not reused', async () => {
    globalThis.fetch = vi.fn(async () => ok({ message: 'odd' }, 'W/"odd"'));
    expect(await getReleases()).toEqual({ message: 'odd' });
    await getReleases();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(sentHeaders(1)['If-None-Match']).toBeUndefined();
  });
});

describe('"has anything changed?" across launches', () => {
  it('the first launch asks for the whole list; the next sends its ETag back and uses the kept list on 304', async () => {
    const first = await getReleases();
    expect(sentHeaders(0)['If-None-Match']).toBeUndefined();
    expect(sentHeaders(0).Accept).toBe('application/vnd.github+json');

    __resetReleasesLookup({ relaunch: true });
    globalThis.fetch.mockResolvedValueOnce(notModified());
    expect(await getReleases()).toEqual(first);
    expect(sentHeaders(1)['If-None-Match']).toBe('W/"etag-1"');
  });

  it('a manual check in the same launch sends the ETag too', async () => {
    await getReleases();
    globalThis.fetch.mockResolvedValueOnce(notModified());
    expect(await getReleases({ revalidate: true })).toEqual(slimReleases(LISTING));
    expect(sentHeaders(1)['If-None-Match']).toBe('W/"etag-1"');
  });

  it('a changed list replaces the kept one and its ETag', async () => {
    await getReleases();
    __resetReleasesLookup({ relaunch: true });
    const newer = [full('js-1.1.23', 'locus-bundle.zip'), ...LISTING];
    globalThis.fetch.mockResolvedValueOnce(ok(newer, 'W/"etag-2"'));
    expect(await getReleases()).toEqual(slimReleases(newer));

    __resetReleasesLookup({ relaunch: true });
    globalThis.fetch.mockResolvedValueOnce(notModified());
    expect((await getReleases())[0].tag_name).toBe('js-1.1.23');
    expect(sentHeaders(2)['If-None-Match']).toBe('W/"etag-2"');
  });

  it('without an ETag nothing is kept, and the next launch asks for the whole list', async () => {
    globalThis.fetch = vi.fn(async () => ok(LISTING));
    await getReleases();
    __resetReleasesLookup({ relaunch: true });
    await getReleases();
    expect(sentHeaders(1)['If-None-Match']).toBeUndefined();
  });

  it('ignores a kept list for another repo, or one that cannot be read', async () => {
    for (const kept of [
      JSON.stringify({ url: 'https://api.github.com/repos/someone/else/releases?per_page=30', etag: 'W/"x"', releases: [] }),
      JSON.stringify({ url: RELEASES_API, etag: '', releases: [] }),
      JSON.stringify({ url: RELEASES_API, etag: 'W/"x"', releases: 'nope' }),
      '{not json',
    ]) {
      __resetReleasesLookup();
      localStorage.setItem('locus.releases', kept);
      globalThis.fetch = vi.fn(async () => ok(LISTING));
      await getReleases();
      expect(sentHeaders(0)['If-None-Match'], kept).toBeUndefined();
    }
  });

  it('a 304 with nothing kept is an error, never an empty list', async () => {
    globalThis.fetch = vi.fn(async () => notModified());
    await expect(getReleases()).rejects.toMatchObject({ code: 'HTTP_304', status: 304 });
  });

  it('works when the phone will not store anything', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(await getReleases()).toEqual(slimReleases(LISTING));
  });
});

describe('when GitHub refuses or fails', () => {
  it('403 is RATE_LIMITED, with when the hourly limit refills', async () => {
    globalThis.fetch = vi.fn(async () => refused(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791828397' }));
    await expect(getReleases()).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 403, resetAt: new Date(1791828397 * 1000) });
  });

  it('429 is RATE_LIMITED, refilling after Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T18:00:00Z'));
    globalThis.fetch = vi.fn(async () => refused(429, { 'retry-after': '30' }));
    await expect(getReleases()).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, resetAt: new Date('2026-10-12T18:00:30Z') });
  });

  it('a refusal that says nothing about when has no refill time', async () => {
    globalThis.fetch = vi.fn(async () => refused(403));
    await expect(getReleases()).rejects.toMatchObject({ code: 'RATE_LIMITED', resetAt: null });
    // X-RateLimit-Reset alone, with requests still left, is not this refusal's refill time.
    expect(rateLimitResetAt(refused(403, { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1791828397' }))).toBeNull();
    expect(rateLimitResetAt({ status: 403 })).toBeNull();
  });

  it('any other status carries its code and status', async () => {
    for (const status of [404, 500, 502]) {
      __resetReleasesLookup();
      globalThis.fetch = vi.fn(async () => refused(status));
      await expect(getReleases()).rejects.toMatchObject({ code: `HTTP_${status}`, status, message: `GitHub returned HTTP ${status}` });
    }
  });

  it('gives up after 15 s with the fetch\'s AbortError', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const lookup = getReleases();
    const outcome = expect(lookup).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(14999);
    expect(signalOf(0).aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
  });
});

const signalOf = (call) => globalThis.fetch.mock.calls[call][1].signal;

describe('the trimmed list', () => {
  it('reads the same to every parser as GitHub\'s full answer', () => {
    const slim = slimReleases(LISTING);
    expect(selectLatestApkRelease(LISTING)).not.toBeNull();
    expect(selectLatestBundleRelease(LISTING)).not.toBeNull();
    expect(selectLatestApkRelease(slim)).toEqual(selectLatestApkRelease(LISTING));
    expect(selectLatestBundleRelease(slim)).toEqual(selectLatestBundleRelease(LISTING));
    for (const installed of ['1.1.0', '1.1.21', null]) {
      expect(selectInstallerRelease(slim, installed)).toEqual(selectInstallerRelease(LISTING, installed));
    }
  });

  it('keeps only what the parsers read, so the copy on the phone stays small', () => {
    const [release] = slimReleases(LISTING);
    expect(Object.keys(release).sort()).toEqual(['assets', 'body', 'draft', 'name', 'prerelease', 'published_at', 'tag_name']);
    expect(Object.keys(release.assets[0]).sort()).toEqual(['browser_download_url', 'name', 'size']);
    expect(JSON.stringify(slimReleases(LISTING)).length).toBeLessThan(JSON.stringify(LISTING).length / 3);
  });

  it('passes through what is not a list or not a release, for the parsers to skip', () => {
    expect(slimReleases(null)).toBeNull();
    expect(slimReleases([null, 'x', { tag_name: 'v1.0.0', assets: 'odd' }])).toEqual([null, 'x', expect.objectContaining({ tag_name: 'v1.0.0', assets: 'odd' })]);
  });
});
