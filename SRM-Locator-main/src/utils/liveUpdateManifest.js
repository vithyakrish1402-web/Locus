// Pure logic for Phase 2 (JS-only live updates). Phase 1's full-APK updater is in
// updateManifest.js; this is the same idea one tier down — no reinstall, just a new web
// bundle swapped into the already-installed native shell.
//
// Same trick as Phase 1: the GitHub release IS the manifest. JS bundles use their own
// tag series so they never collide with native releases:
//
//   v1.2.0    -> a native APK release   (Phase 1)
//   js-1.2.1  -> a JS bundle release    (Phase 2)
//
// The release body carries two machine-readable lines:
//
//   SHA256: <64 hex>       verified natively by @capgo/capacitor-updater
//   MIN_NATIVE: 1.2.0      the oldest native shell this bundle may run on
//
// MIN_NATIVE is the whole safety story. A JS-only update can never add a native
// permission or plugin, so a bundle calling an API the installed shell lacks would white
// out the app with no way back except a manual reinstall. Anything touching native code
// must ship as a Phase 1 APK release and raise MIN_NATIVE accordingly.

// Explicit .js extension, unlike most imports in this codebase: scripts/verify-release.mjs
// imports this module directly under plain Node, which resolves ESM strictly and will not
// guess the extension the way Vite does. Vite is happy either way.
import { compareVersions, parseVersion } from './updateManifest.js';

/** Release asset holding the zipped `dist/` output. */
export const BUNDLE_ASSET_NAME = 'locus-bundle.zip';

/** Tag prefix that distinguishes a JS bundle release from a native APK release. */
export const BUNDLE_TAG_PREFIX = 'js-';

const SHA256_LINE = /^[ \t]*SHA-?256[ \t]*[:=][ \t]*([0-9a-fA-F]{64})[ \t]*$/m;
const MIN_NATIVE_LINE = /^[ \t]*MIN[_-]?NATIVE[ \t]*[:=][ \t]*([vV]?\d+(?:\.\d+){0,2})[ \t]*$/m;

/** Strip the machine-readable lines so the toast/notes show human text only. */
export function extractBundleNotes(body) {
  if (typeof body !== 'string') return '';
  return body
    .split(/\r?\n/)
    .filter((line) => !SHA256_LINE.test(line) && !MIN_NATIVE_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Turn one GitHub release into a bundle manifest.
 * @returns {{ok: true, manifest: object} | {ok: false, reason: string}}
 */
export function parseBundleRelease(release) {
  if (!release || typeof release !== 'object') return { ok: false, reason: 'MALFORMED_RELEASE' };
  if (release.draft) return { ok: false, reason: 'DRAFT_RELEASE' };
  // Prereleases are excluded for the same reason drafts are: marking a release as one is
  // how you say "not for everybody yet". Phase 1 got this free from /releases/latest,
  // which filters both server-side; Phase 2 has always read the list endpoint, which
  // returns everything, so without this a release flagged prerelease for internal testing
  // would have gone straight to every device on its next cold start. release-bundle.mjs
  // never publishes one, so any prerelease js-* tag was created by hand — which makes the
  // intent behind it explicit rather than accidental.
  if (release.prerelease) return { ok: false, reason: 'PRERELEASE' };

  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  if (!tag.startsWith(BUNDLE_TAG_PREFIX)) return { ok: false, reason: 'NOT_A_BUNDLE_RELEASE' };

  const version = parseVersion(tag.slice(BUNDLE_TAG_PREFIX.length));
  if (!version) return { ok: false, reason: 'UNPARSEABLE_TAG' };

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const zip = assets.find((asset) => asset && asset.name === BUNDLE_ASSET_NAME);
  if (!zip || typeof zip.browser_download_url !== 'string') return { ok: false, reason: 'MISSING_BUNDLE_ASSET' };

  const body = typeof release.body === 'string' ? release.body : '';

  const sha = SHA256_LINE.exec(body);
  if (!sha) return { ok: false, reason: 'MISSING_CHECKSUM' };

  const minNative = MIN_NATIVE_LINE.exec(body);
  // No MIN_NATIVE means nobody decided which shells this bundle is safe on, and the
  // failure mode is a white screen on a device that cannot roll itself back. Refuse.
  if (!minNative) return { ok: false, reason: 'MISSING_MIN_NATIVE' };

  return {
    ok: true,
    manifest: {
      version: version.join('.'),
      tag,
      zipUrl: zip.browser_download_url,
      zipSize: typeof zip.size === 'number' ? zip.size : null,
      sha256: sha[1].toLowerCase(),
      minNative: (parseVersion(minNative[1]) || []).join('.'),
      notes: extractBundleNotes(body),
    },
  };
}

/**
 * Pick the highest-versioned bundle release out of a `/releases` listing.
 *
 * Sorts by version rather than trusting GitHub's created_at ordering, so a republished
 * or back-dated release can't hand an older bundle to every device.
 */
export function selectLatestBundleRelease(releases) {
  if (!Array.isArray(releases)) return null;
  let best = null;
  for (const release of releases) {
    const parsed = parseBundleRelease(release);
    if (!parsed.ok) continue;
    if (!best || compareVersions(parsed.manifest.version, best.version) === 1) {
      best = parsed.manifest;
    }
  }
  return best;
}

/**
 * Is the installed native shell new enough to run this bundle?
 *
 * Fails closed: an unreadable version on either side blocks the swap. Refusing a good
 * update costs a delay; applying a bad one costs a manual reinstall on every device.
 */
export function isBundleCompatible(nativeVersion, minNative) {
  const result = compareVersions(nativeVersion, minNative);
  return result !== null && result >= 0;
}

/**
 * Should this bundle be downloaded and staged?
 *
 * @param {object} input
 * @param {string} input.nativeVersion         App.getInfo().version - the native shell
 * @param {string} input.currentBundleVersion  CapacitorUpdater.current() - what is running now
 * @param {object|null} input.manifest         from selectLatestBundleRelease
 * @returns {{apply: boolean, reason: string}}
 */
export function shouldApplyBundle({ nativeVersion, currentBundleVersion, manifest }) {
  if (!manifest) return { apply: false, reason: 'NO_BUNDLE_PUBLISHED' };

  if (!isBundleCompatible(nativeVersion, manifest.minNative)) {
    // The native shell is too old. Phase 1 has to run first; this is the gate that stops
    // a bundle from bricking an old install rather than the thing that fixes it.
    return { apply: false, reason: 'NATIVE_TOO_OLD' };
  }

  // "builtin" is what the plugin reports for the bundle compiled into the APK. Treat it
  // as the native version: a fresh APK install already carries that release's JS.
  const running = !currentBundleVersion || currentBundleVersion === 'builtin' ? nativeVersion : currentBundleVersion;

  if (compareVersions(manifest.version, running) !== 1) {
    return { apply: false, reason: 'ALREADY_CURRENT' };
  }

  return { apply: true, reason: 'UPDATE_AVAILABLE' };
}
