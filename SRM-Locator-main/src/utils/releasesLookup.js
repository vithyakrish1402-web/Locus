// The one place LOCUS asks GitHub for its list of releases. The update check
// (useAppUpdate), the live-update check (useLiveUpdate) and Send LOCUS to someone (SendApp)
// all read it from here.
//
// GitHub allows 60 anonymous API requests an hour per public internet address, and everyone
// behind the same address (campus Wi-Fi, a mobile carrier's shared address) draws from the
// same 60. Two things keep LOCUS's share of them small:
//
// - One answer per launch. The first caller asks GitHub; a caller that arrives while that
//   request is out waits for the same answer, and later callers reuse it. Only a failed
//   lookup is asked again. A manual "Check for updates" asks again (`revalidate`), because
//   the person wants news now.
// - "Has anything changed?" The last list is kept on the phone with GitHub's ETag, which
//   every request sends back (If-None-Match). An unchanged list comes back as 304, which
//   GitHub does not count against the limit, and the kept copy is used.
//
// Once the 60 are used up GitHub refuses even those, with 403. That is RATE_LIMITED, with
// `resetAt` (when the limit refills) whenever GitHub says.

const REPO = import.meta.env?.VITE_UPDATE_REPO || 'vithyakrish1402-web/Locus';
// The listing rather than /releases/latest: "latest" is whichever release is newest overall,
// and the v* and js-* series share the repo, so it would hide one series behind the other.
// Each reader picks its own series out of the listing.
export const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const LOOKUP_TIMEOUT_MS = 15000;
const KEPT_KEY = 'locus.releases';

let launchAnswer = null;
let inFlight = null;

/**
 * Exported for tests: forget this launch's answer and the copy kept on the phone, or with
 * `relaunch` only this launch's answer, as closing and reopening the app does.
 */
export function __resetReleasesLookup({ relaunch = false } = {}) {
  launchAnswer = null;
  inFlight = null;
  if (relaunch) return;
  try {
    localStorage.removeItem(KEPT_KEY);
  } catch {
    // Storage unavailable: nothing was kept.
  }
}

// Only the fields the release parsers read (updateManifest.js, liveUpdateManifest.js), so
// the copy kept on the phone is a few KB rather than GitHub's 130. Callers get this shape
// from GitHub's answer and from the kept copy alike. A parser that starts reading another
// field must add it here.
const slimAsset = (asset) =>
  asset && typeof asset === 'object' ? { name: asset.name, browser_download_url: asset.browser_download_url, size: asset.size } : asset;
const slimRelease = (release) =>
  release && typeof release === 'object'
    ? {
        tag_name: release.tag_name,
        name: release.name,
        body: release.body,
        draft: release.draft,
        prerelease: release.prerelease,
        published_at: release.published_at,
        assets: Array.isArray(release.assets) ? release.assets.map(slimAsset) : release.assets,
      }
    : release;
export const slimReleases = (releases) => (Array.isArray(releases) ? releases.map(slimRelease) : releases);

function readKept() {
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT_KEY));
    if (kept && kept.url === RELEASES_API && typeof kept.etag === 'string' && kept.etag && Array.isArray(kept.releases)) return kept;
  } catch {
    // Unreadable or unavailable: ask for the whole list.
  }
  return null;
}

function keep(etag, releases) {
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify({ url: RELEASES_API, etag, releases }));
  } catch {
    // Storage full or unavailable: the next launch asks for the whole list.
  }
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

async function lookup() {
  const kept = readKept();
  const headers = { Accept: 'application/vnd.github+json' };
  if (kept) headers['If-None-Match'] = kept.etag;

  // AbortController rather than the platform timeout: a stalled request would otherwise
  // leave a spinner turning forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(RELEASES_API, { headers, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 304) {
    if (kept) return kept.releases;
    throw lookupError('HTTP_304', 'GitHub returned HTTP 304', { status: 304 });
  }
  // 403 is how GitHub refuses a request over the limit; 429 is its short-term limit.
  if (response.status === 403 || response.status === 429) {
    throw lookupError('RATE_LIMITED', 'GitHub rate limit reached', { status: response.status, resetAt: rateLimitResetAt(response) });
  }
  if (!response.ok) throw lookupError(`HTTP_${response.status}`, `GitHub returned HTTP ${response.status}`, { status: response.status });

  const releases = slimReleases(await response.json());
  const etag = response.headers?.get?.('ETag');
  if (etag && Array.isArray(releases)) keep(etag, releases);
  return releases;
}

/**
 * GitHub's list of LOCUS releases (newest first, as GitHub orders them), trimmed to the
 * fields the parsers read. Rejects with `code` RATE_LIMITED (and `resetAt`), HTTP_<status>
 * (and `status`), or the fetch's own error (an AbortError after 15 s, a TypeError offline).
 *
 * @param {{revalidate?: boolean}} [options] revalidate: ask GitHub again even if this launch
 *   already has an answer (a manual check). A request already out is shared either way.
 * @returns {Promise<Array<object>>}
 */
export function getReleases({ revalidate = false } = {}) {
  if (inFlight) return inFlight;
  if (launchAnswer && !revalidate) return Promise.resolve(launchAnswer);
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
