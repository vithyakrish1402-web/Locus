// The one place LOCUS asks GitHub for its list of releases. The update check
// (useAppUpdate), the live-update check (useLiveUpdate) and Send LOCUS to someone (SendApp)
// all read it from here.
//
// GitHub allows 60 anonymous API requests an hour per public internet address, and everyone
// behind the same address (campus Wi-Fi, a mobile carrier's shared address) draws from the
// same 60. So a launch asks once: the first caller asks GitHub, a caller that arrives while
// that request is out waits for the same answer, and later callers reuse it. Only a failed
// lookup is asked again. A manual "Check for updates" asks again (`fresh`), because the
// person wants news now.
//
// Asking "has anything changed?" (If-None-Match with the last ETag) would not help: GitHub
// counts an anonymous 304 against the limit like any other answer (measured 2026-10-12).
//
// Once the 60 are used up GitHub refuses with 403. That is RATE_LIMITED, with `resetAt`
// (when the limit refills) whenever GitHub says.
//
// So the lookup reads the update index first (utils/updateIndex.js): the same list, as a file
// on a release, which downloads without touching that limit. Only when the file cannot be
// read or is not trusted does it ask the API listing, exactly as before.

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { parseUpdateIndex, updateIndexUrl } from './updateIndex.js';

const REPO = import.meta.env?.VITE_UPDATE_REPO || 'vithyakrish1402-web/Locus';
// The listing rather than /releases/latest: "latest" is whichever release is newest overall,
// and the v* and js-* series share the repo, so it would hide one series behind the other.
// Each reader picks its own series out of the listing. 100, GitHub's most per page: with 30, a
// run of 30 bundles pushed the newest APK off the page and the APK check went blind.
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
const LOOKUP_TIMEOUT_MS = 15000;
// The file is small; past this the API listing is asked instead. Exported for tests.
export const UPDATE_INDEX_TIMEOUT_MS = 10000;
// A whole check (the file, then the listing if needed) ends by this, so "Checking…" never
// hangs: the two lookups above could take 25 s between them.
export const UPDATE_CHECK_TIMEOUT_MS = 15000;

/** `promise`, or a rejection with code TIMEOUT once `ms` pass. */
export function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(lookupError('TIMEOUT', 'The update server took too long to answer')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

let launchAnswer = null;
let inFlight = null;

/** Exported for tests: forget this launch's answer, as closing and reopening the app does. */
export function __resetReleasesLookup() {
  launchAnswer = null;
  inFlight = null;
}

/**
 * When GitHub's limit refills, from a refused answer's headers: X-RateLimit-Reset (epoch
 * seconds) once the hourly limit is used up, or Retry-After (seconds) for its short-term
 * limit. Null when it says neither.
 */
export function rateLimitResetAt(response, now = Date.now()) {
  const header = (name) => response?.headers?.get?.(name) ?? null;
  const reset = Number(header('X-RateLimit-Reset'));
  if (header('X-RateLimit-Remaining') === '0' && Number.isFinite(reset) && reset > 0) return new Date(reset * 1000);
  const retryAfter = header('Retry-After');
  if (retryAfter !== null && Number.isFinite(Number(retryAfter)) && Number(retryAfter) >= 0) return new Date(now + Number(retryAfter) * 1000);
  return null;
}

const lookupError = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });

// The update index is read with Capacitor's built-in native HTTP plugin only. GitHub's download
// links carry no CORS headers, so the WebView's own fetch cannot read the file (checked
// 2026-10-13). A browser preview has no native plugin.
function nativeHttpAvailable() {
  try {
    return Boolean(Capacitor.isNativePlatform?.() && Capacitor.isPluginAvailable?.('CapacitorHttp'));
  } catch {
    return false;
  }
}

/**
 * The releases from the update index, or why not. Never throws.
 * @returns {Promise<{ok: true, releases: object[]} | {ok: false, reason: string}>}
 */
async function readUpdateIndex() {
  let timer;
  try {
    const response = await Promise.race([
      CapacitorHttp.get({
        // A fresh copy every time: without the marker GitHub served a replaced file for minutes.
        url: updateIndexUrl(REPO, Date.now()),
        responseType: 'text',
        connectTimeout: UPDATE_INDEX_TIMEOUT_MS,
        readTimeout: UPDATE_INDEX_TIMEOUT_MS,
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), UPDATE_INDEX_TIMEOUT_MS);
      }),
    ]);
    if (response?.timedOut) return { ok: false, reason: 'TIMEOUT' };
    if (response?.status !== 200) return { ok: false, reason: `HTTP_${response?.status}` };
    let data = response.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return { ok: false, reason: 'MALFORMED' };
      }
    }
    return parseUpdateIndex(data, { repo: REPO, now: Date.now() });
  } catch (e) {
    return { ok: false, reason: e?.message || 'UNREADABLE' };
  } finally {
    clearTimeout(timer);
  }
}

function lookup() {
  // No native plugin (a browser preview): the API listing, exactly as before.
  if (!nativeHttpAvailable()) return lookupFromApi();
  return readUpdateIndex().then((index) => {
    if (index.ok) return index.releases;
    console.warn('[UPDATES] Update index not used, asking the GitHub API:', index.reason);
    return lookupFromApi();
  });
}

async function lookupFromApi() {
  // AbortController rather than the platform timeout: a stalled request would otherwise
  // leave a spinner turning forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }

  // 403 is how GitHub refuses a request over the limit; 429 is its short-term limit.
  if (response.status === 403 || response.status === 429) {
    throw lookupError('RATE_LIMITED', 'GitHub rate limit reached', { status: response.status, resetAt: rateLimitResetAt(response) });
  }
  if (!response.ok) throw lookupError(`HTTP_${response.status}`, `GitHub returned HTTP ${response.status}`, { status: response.status });
  return response.json();
}

/**
 * GitHub's list of LOCUS releases (newest first, as GitHub orders them), from the update index
 * or, when that cannot be used, the API listing. Only the API listing's failures reach the
 * caller: it rejects with `code` RATE_LIMITED (and `resetAt`), HTTP_<status> (and `status`), or
 * the fetch's own error (an AbortError after 15 s, a TypeError offline).
 *
 * @param {{fresh?: boolean}} [options] fresh: ask GitHub again even if this launch already
 *   has an answer (a manual check). A request already out is shared either way.
 * @returns {Promise<Array<object>>}
 */
export function getReleases({ fresh = false } = {}) {
  if (inFlight) return inFlight;
  if (launchAnswer && !fresh) return Promise.resolve(launchAnswer);
  inFlight = lookup()
    .then((releases) => {
      // Something that isn't a list is passed on (the parsers find nothing in it) but never
      // reused: the next caller asks again.
      if (Array.isArray(releases)) launchAnswer = releases;
      return releases;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
