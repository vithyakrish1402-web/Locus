// Pure parsing/comparison logic for the in-app updater.
//
// The "update manifest" is just GitHub's own release JSON — there is deliberately no
// separate manifest file to keep in sync. `GET /repos/:owner/:repo/releases/latest`
// gives us everything the updater needs:
//
//   tag_name -> the version                      (e.g. "v1.2.0")
//   assets[] -> the APK download URL             (asset named APK_ASSET_NAME)
//   body     -> release notes, plus two markers the release script writes in:
//                 "SHA256: <64 hex>"  -> integrity check, verified before install
//                 "[MANDATORY]"       -> blocks normal app use until updated
//
// Everything here is side-effect free so it can be unit tested without a device,
// a network, or Capacitor (see tests/updateManifest.test.js).

/** Release asset the updater looks for. Stable name, so no client change per release. */
export const APK_ASSET_NAME = 'locus-latest.apk';

/** Literal marker in the release body that makes an update non-dismissable. */
export const MANDATORY_MARKER = '[MANDATORY]';

/**
 * Tag prefix that marks a native APK release, mirroring liveUpdateManifest's
 * BUNDLE_TAG_PREFIX. The two tag series share a repo, so neither tier can assume a
 * listing holds only its own releases.
 */
export const APK_TAG_PREFIX = 'v';

// "SHA256: abc..." / "sha-256 = ABC..." — tolerant of separator and case, but the
// digest itself must be exactly 64 hex chars so a truncated paste can't pass.
const SHA256_LINE = /^[ \t]*SHA-?256[ \t]*[:=][ \t]*([0-9a-fA-F]{64})[ \t]*$/m;

// Accepts "1", "1.2", "1.2.3", with an optional leading v and an optional
// -prerelease/+build suffix which is ignored for ordering purposes.
const SEMVER = /^[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/;

/**
 * Parse a version string into [major, minor, patch].
 * @returns {number[]|null} null when the string isn't a recognisable version.
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * Compare two version strings.
 * @returns {number|null} -1 if a < b, 0 if equal, 1 if a > b; null if either is unparseable.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

/**
 * Is `candidate` strictly newer than `installed`?
 *
 * Fails closed: an unparseable version on either side counts as "no update" rather
 * than nagging every launch over a typo'd tag.
 */
export function isUpdateAvailable(installed, candidate) {
  return compareVersions(candidate, installed) === 1;
}

/**
 * Strip the machine-readable markers out of the release body so the modal shows
 * human release notes only.
 */
export function extractNotes(body) {
  if (typeof body !== 'string') return '';
  return body
    .split(/\r?\n/)
    .filter((line) => !SHA256_LINE.test(line) && !line.includes(MANDATORY_MARKER))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Turn a GitHub release object into the updater's manifest shape.
 *
 * @param {object} release  Parsed JSON from /releases/latest
 * @param {{assetName?: string}} [options]
 * @returns {{ok: true, manifest: object} | {ok: false, reason: string}}
 */
export function parseReleaseManifest(release, options = {}) {
  const assetName = options.assetName ?? APK_ASSET_NAME;

  if (!release || typeof release !== 'object') {
    return { ok: false, reason: 'MALFORMED_RELEASE' };
  }
  if (release.draft) return { ok: false, reason: 'DRAFT_RELEASE' };

  const version = parseVersion(release.tag_name);
  if (!version) return { ok: false, reason: 'UNPARSEABLE_TAG' };

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const apk = assets.find((asset) => asset && asset.name === assetName);
  if (!apk || typeof apk.browser_download_url !== 'string') {
    return { ok: false, reason: 'MISSING_APK_ASSET' };
  }

  const body = typeof release.body === 'string' ? release.body : '';
  const sha = SHA256_LINE.exec(body);
  // No checksum means we have nothing to verify against, and the brief is explicit
  // that install must never proceed unverified — so treat it as a bad release.
  if (!sha) return { ok: false, reason: 'MISSING_CHECKSUM' };

  return {
    ok: true,
    manifest: {
      // Normalised without the leading "v" so it renders next to App.getInfo().version.
      version: version.join('.'),
      tag: release.tag_name,
      apkUrl: apk.browser_download_url,
      apkSize: typeof apk.size === 'number' ? apk.size : null,
      sha256: sha[1].toLowerCase(),
      mandatory: body.includes(MANDATORY_MARKER),
      prerelease: Boolean(release.prerelease),
      notes: extractNotes(body),
    },
  };
}

/**
 * Pick the latest native APK release out of a `/releases` listing.
 *
 * Phase 1 used to read `/releases/latest`, which is whichever release was published most
 * recently across *every* tag series — it knows nothing about `v*` versus `js-*`. Once
 * both series existed, publishing a JS bundle made this check return a `js-` tag that
 * parseVersion cannot read, and the whole check failed closed. Failing closed is right
 * (better than nagging over a typo'd tag) but the consequence is severe: a device on an
 * old shell silently never learns a real APK update exists, which is exactly the device
 * a [MANDATORY] release is meant to reach.
 *
 * Excludes drafts and prereleases explicitly. `/releases/latest` did that server-side for
 * free; the list endpoint returns everything, so dropping the old endpoint means taking
 * that filtering over by hand.
 *
 * Scans for the highest version rather than taking the first survivor, the same as
 * selectLatestBundleRelease: GitHub's listing order follows publish date, so a
 * republished or back-dated release could otherwise offer every device an older APK.
 *
 * @param {object[]} releases  Parsed JSON from /repos/:owner/:repo/releases
 * @param {{assetName?: string}} [options]
 * @returns {object|null} the manifest, or null when no usable v* release exists
 */
export function selectLatestApkRelease(releases, options = {}) {
  if (!Array.isArray(releases)) return null;
  let best = null;
  for (const release of releases) {
    if (!release || typeof release !== 'object') continue;
    if (release.draft || release.prerelease) continue;

    const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
    if (!tag.toLowerCase().startsWith(APK_TAG_PREFIX)) continue;

    const parsed = parseReleaseManifest(release, options);
    if (!parsed.ok) continue;
    if (!best || compareVersions(parsed.manifest.version, best.version) === 1) {
      best = parsed.manifest;
    }
  }
  return best;
}

/**
 * The installer "Send App" (SYS_CONFIG) hands out: the APK release matching the version
 * installed on this phone, so what you send is what you run - or, when that release has
 * no usable APK (a debug build, a version never released) or the version is unknown (the
 * web build), the newest APK release. Either way the recipient's copy then live-updates
 * like the sender's.
 *
 * @param {object[]} releases  Parsed JSON from /repos/:owner/:repo/releases
 * @param {string|null} installedVersion  App.getInfo().version, or null off-device
 * @returns {object|null} a parseReleaseManifest manifest (version, apkUrl, apkSize, ...)
 */
export function selectInstallerRelease(releases, installedVersion) {
  if (!Array.isArray(releases)) return null;
  const wanted = parseVersion(installedVersion);
  if (wanted) {
    for (const release of releases) {
      if (!release || typeof release !== 'object' || release.draft) continue;
      const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
      if (!tag.toLowerCase().startsWith(APK_TAG_PREFIX)) continue;
      const parsed = parseReleaseManifest(release);
      if (parsed.ok && compareVersions(parsed.manifest.version, wanted.join('.')) === 0) return parsed.manifest;
    }
  }
  return selectLatestApkRelease(releases);
}
