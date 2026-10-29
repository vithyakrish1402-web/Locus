// The update index: a copy of the parts of GitHub's releases list that the update checks read,
// published as one file on a release of its own, so a launch can read it without the API.
//
// GitHub allows 60 anonymous API requests an hour per public address, and everyone behind the
// same address (campus Wi-Fi) shares them, so the releases listing (utils/releasesLookup.js)
// can be refused for up to an hour. A file attached to a release downloads from github.com,
// which that limit does not count (measured 2026-10-13: 60 downloads, counter unchanged, and
// downloads still worked while the API was refusing). The release scripts rebuild the file
// from the real releases as their last step (scripts/lib/updateIndex.mjs), and
// `npm run release:index` rebuilds it by hand.
//
// The file is laid out like GitHub's own listing, trimmed to the fields the update checks read,
// so the same parsers (updateManifest.js, liveUpdateManifest.js) run on it unchanged:
//
//   { "formatVersion": 1, "generatedAt": "<ISO time>", "releases": [
//       { "tag_name", "prerelease", "body", "assets": [{ "name", "browser_download_url", "size" }] },
//       ... ] }
//
// The app trusts the file only when parseUpdateIndex accepts it. Anything else falls back to
// the API listing, so a bad file can cost one API request but never offers anything on its own.

// Explicit .js extensions: the release scripts import this module under plain Node (see
// liveUpdateManifest.js).
import { APK_ASSET_NAME, APK_TAG_PREFIX, selectLatestApkRelease } from './updateManifest.js';
import { BUNDLE_ASSET_NAME, BUNDLE_TAG_PREFIX, selectLatestBundleRelease } from './liveUpdateManifest.js';

/** The release holding the file: a pre-release, so it is never GitHub's "latest". */
export const UPDATE_INDEX_TAG = 'update-index';
export const UPDATE_INDEX_ASSET_NAME = 'update-index.json';
export const UPDATE_INDEX_FORMAT_VERSION = 1;

// Owner's decisions (2026-10-13):
// - UPDATE_INDEX_MAX_AGE_HOURS: a last-resort safety net, not a freshness rule. The file is
//   rebuilt only when a release is made, and a week or more can pass between releases. It stops
//   a file nobody has rebuilt in a month (a release made by hand, a failed rebuild never re-run)
//   from being trusted for ever. Past it the app uses the API listing.
// - UPDATE_INDEX_FUTURE_TOLERANCE_HOURS: a file dated further ahead of the phone's clock than
//   this means the clock is wrong, and then the file's age says nothing. 24 h covers a phone
//   set by hand to the wrong time zone (up to 14 h out) with room to spare.
export const UPDATE_INDEX_MAX_AGE_HOURS = 720;
export const UPDATE_INDEX_FUTURE_TOLERANCE_HOURS = 24;

/** How many of the newest releases the file carries (plus the newest of each series, wherever they are). */
export const UPDATE_INDEX_RELEASE_COUNT = 30;

const HOUR_MS = 60 * 60 * 1000;

// The same tag tests the update checks use: v* (case-insensitive) for APKs, js-* for bundles.
const isReleaseTag = (tag) =>
  typeof tag === 'string' && (tag.toLowerCase().startsWith(APK_TAG_PREFIX) || tag.startsWith(BUNDLE_TAG_PREFIX));

/** The file's address, with a fresh-copy marker: GitHub keeps serving a replaced file for minutes without one. */
export function updateIndexUrl(repo, now = Date.now()) {
  return `https://github.com/${repo}/releases/download/${UPDATE_INDEX_TAG}/${UPDATE_INDEX_ASSET_NAME}?t=${now}`;
}

/** Is `link` a download from this project's own GitHub releases (https://github.com/<repo>/releases/download/...)? */
export function isOwnReleaseLink(link, repo) {
  if (typeof link !== 'string' || typeof repo !== 'string' || !repo) return false;
  let url;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  // The parsed path, so "../" tricks are resolved before the comparison. GitHub names are
  // case-insensitive.
  return (
    url.protocol === 'https:' &&
    url.host === 'github.com' &&
    url.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/download/`)
  );
}

/**
 * Build the file from GitHub's releases list (newest first, as GitHub orders it): the newest
 * UPDATE_INDEX_RELEASE_COUNT v* and js-* releases, drafts left out, each trimmed to the fields
 * the update checks read, plus the newest APK and the newest bundle wherever they are in the
 * list. Without those two, 30 bundles in a row pushed the APK out of the file: the app then
 * refused the file (NO_USABLE_APK) and the API listing it fell back on had lost it too. Used by
 * the release scripts and release:verify.
 */
export function buildUpdateIndex(releases, { now = Date.now() } = {}) {
  if (!Array.isArray(releases)) throw new Error('the releases list is not a list');
  const wanted = new Set([APK_ASSET_NAME, BUNDLE_ASSET_NAME]);
  const candidates = releases.filter((release) => release && typeof release === 'object' && !release.draft && isReleaseTag(release.tag_name));
  const kept = candidates.slice(0, UPDATE_INDEX_RELEASE_COUNT);
  for (const newest of [selectLatestApkRelease(candidates), selectLatestBundleRelease(candidates)]) {
    if (newest && !kept.some((release) => release.tag_name === newest.tag)) {
      kept.push(candidates.find((release) => release.tag_name === newest.tag));
    }
  }
  return {
    formatVersion: UPDATE_INDEX_FORMAT_VERSION,
    generatedAt: new Date(now).toISOString(),
    releases: kept
      .map((release) => ({
        tag_name: release.tag_name,
        prerelease: Boolean(release.prerelease),
        body: typeof release.body === 'string' ? release.body : '',
        assets: (Array.isArray(release.assets) ? release.assets : [])
          .filter((asset) => asset && wanted.has(asset.name))
          .map(({ name, browser_download_url, size }) => ({ name, browser_download_url, size })),
      })),
  };
}

const rejected = (reason) => ({ ok: false, reason });

/**
 * Can the app trust this file? Fails closed: on any doubt it is rejected and the app asks the
 * API listing instead.
 *
 * @param {unknown} data  the file, parsed from JSON
 * @param {{repo: string, now?: number}} options  repo: owner/name the download links must belong to
 * @returns {{ok: true, releases: object[]} | {ok: false, reason: string}}
 *   reason: MALFORMED, UNKNOWN_FORMAT, TOO_OLD, FUTURE_DATED, FOREIGN_LINK, NO_USABLE_APK or
 *   NO_USABLE_BUNDLE
 */
export function parseUpdateIndex(data, { repo, now = Date.now() } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return rejected('MALFORMED');
  // First: a later format may mean different fields.
  if (data.formatVersion !== UPDATE_INDEX_FORMAT_VERSION) return rejected('UNKNOWN_FORMAT');

  const generatedAt = typeof data.generatedAt === 'string' ? Date.parse(data.generatedAt) : NaN;
  if (!Number.isFinite(generatedAt)) return rejected('MALFORMED');
  if (now - generatedAt > UPDATE_INDEX_MAX_AGE_HOURS * HOUR_MS) return rejected('TOO_OLD');
  if (generatedAt - now > UPDATE_INDEX_FUTURE_TOLERANCE_HOURS * HOUR_MS) return rejected('FUTURE_DATED');

  const { releases } = data;
  if (!Array.isArray(releases)) return rejected('MALFORMED');
  // Stricter than the API answer, whose odd entries the parsers skip: this file is one the
  // release scripts wrote, so anything odd in it means it should not be trusted at all.
  for (const release of releases) {
    if (!release || typeof release !== 'object' || !Array.isArray(release.assets)) return rejected('MALFORMED');
    for (const asset of release.assets) {
      if (!asset || typeof asset !== 'object' || typeof asset.browser_download_url !== 'string') return rejected('MALFORMED');
      if (!isOwnReleaseLink(asset.browser_download_url, repo)) return rejected('FOREIGN_LINK');
    }
  }

  // Every real listing has both series, so a file without a usable release of either is wrong.
  if (!selectLatestApkRelease(releases)) return rejected('NO_USABLE_APK');
  if (!selectLatestBundleRelease(releases)) return rejected('NO_USABLE_BUNDLE');
  return { ok: true, releases };
}
