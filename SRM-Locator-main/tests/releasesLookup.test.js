// The one lookup of GitHub's releases list that the APK update check, the live-update check
// and Send LOCUS share (src/utils/releasesLookup.js). GitHub allows 60 anonymous requests an
// hour per public address, shared by everyone on the network (campus Wi-Fi), so a launch
// asks once, and a refusal says when the limit refills.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReleases, RELEASES_API, rateLimitResetAt, __resetReleasesLookup } from '../src/utils/releasesLookup.js';

const LISTING = [
  { tag_name: 'js-1.1.22', draft: false, prerelease: false, body: '', assets: [] },
  { tag_name: 'v1.1.21', draft: false, prerelease: false, body: '', assets: [] },
];

const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null });
const ok = (body) => ({ ok: true, status: 200, headers: headers({}), json: async () => body });
const refused = (status, h = {}) => ({ ok: false, status, headers: headers(h), json: async () => ({ message: 'API rate limit exceeded' }) });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  __resetReleasesLookup();
  globalThis.fetch = vi.fn(async () => ok(LISTING));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('one lookup per launch', () => {
  it('callers at the same time share one request, and later callers reuse its answer', async () => {
    const answer = deferred();
    globalThis.fetch = vi.fn(() => answer.promise);
    const first = getReleases();
    const second = getReleases();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    answer.resolve(ok(LISTING));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(LISTING);
    expect(b).toBe(a);
    expect(await getReleases()).toBe(a);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('asks the releases listing, as a plain request (no headers that need a CORS pre-check)', async () => {
    await getReleases();
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(RELEASES_API);
    expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\?per_page=30$/);
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json' });
    expect(init.cache).toBe('no-store');
  });

  it('a manual check asks GitHub again', async () => {
    await getReleases();
    await getReleases({ fresh: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('a manual check while a request is out shares it', async () => {
    const answer = deferred();
    globalThis.fetch = vi.fn(() => answer.promise);
    const automatic = getReleases();
    const manual = getReleases({ fresh: true });
    answer.resolve(ok(LISTING));
    await Promise.all([automatic, manual]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a failed lookup is not reused: the next caller asks again', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(ok(LISTING));
    await expect(getReleases()).rejects.toThrow('Failed to fetch');
    expect(await getReleases()).toEqual(LISTING);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('a refused lookup is not reused either', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(refused(403)).mockResolvedValue(ok(LISTING));
    await expect(getReleases()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(await getReleases()).toEqual(LISTING);
  });

  it('an answer that is not a list is passed on but not reused', async () => {
    globalThis.fetch = vi.fn(async () => ok({ message: 'odd' }));
    expect(await getReleases()).toEqual({ message: 'odd' });
    await getReleases();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
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

  it("gives up after 15 s with the fetch's AbortError", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const outcome = expect(getReleases()).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(14999);
    expect(globalThis.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
  });
});
