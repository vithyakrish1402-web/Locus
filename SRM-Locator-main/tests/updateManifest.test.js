import { describe, it, expect } from 'vitest';
import {
  APK_ASSET_NAME,
  MANDATORY_MARKER,
  compareVersions,
  extractNotes,
  isUpdateAvailable,
  parseReleaseManifest,
  parseVersion,
  selectLatestApkRelease,
} from '../src/utils/updateManifest';

const release = (overrides = {}) => ({
  tag_name: 'v1.2.0',
  draft: false,
  prerelease: false,
  body: 'Fixed the squad roster.\n\nSHA256: ' + 'a'.repeat(64),
  assets: [{ name: APK_ASSET_NAME, browser_download_url: 'https://example.test/locus.apk', size: 9_000_000 }],
  ...overrides,
});

describe('parseVersion', () => {
  it('accepts plain and v-prefixed semver', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('V10.0.1')).toEqual([10, 0, 1]);
  });

  it('back-fills missing minor/patch so the pre-updater "1.0" style still compares', () => {
    expect(parseVersion('1')).toEqual([1, 0, 0]);
    expect(parseVersion('1.4')).toEqual([1, 4, 0]);
  });

  it('ignores prerelease and build suffixes', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3+build9')).toEqual([1, 2, 3]);
  });

  it('rejects anything that is not a version', () => {
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(12)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.0.2', '1.0.10')).toBe(-1);
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0);
  });

  it('returns null when either side is unparseable', () => {
    expect(compareVersions('nightly', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', undefined)).toBeNull();
  });
});

describe('isUpdateAvailable', () => {
  it('is true only for a strictly newer candidate', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.1')).toBe(true);
    expect(isUpdateAvailable('1.0.0', '1.0.0')).toBe(false);
    expect(isUpdateAvailable('1.1.0', '1.0.9')).toBe(false);
  });

  it('fails closed on a malformed version rather than nagging every launch', () => {
    expect(isUpdateAvailable('1.0.0', 'newest')).toBe(false);
    expect(isUpdateAvailable(null, '2.0.0')).toBe(false);
  });
});

describe('extractNotes', () => {
  it('strips the checksum line and the mandatory marker', () => {
    const notes = extractNotes(`Line one.\nSHA256: ${'b'.repeat(64)}\n${MANDATORY_MARKER}\nLine two.`);
    expect(notes).toBe('Line one.\nLine two.');
  });

  it('collapses the blank runs left behind', () => {
    const notes = extractNotes(`Top.\n\n\nSHA256: ${'c'.repeat(64)}\n\n\nBottom.`);
    expect(notes).toBe('Top.\n\nBottom.');
  });

  it('handles a missing body', () => {
    expect(extractNotes(undefined)).toBe('');
  });
});

describe('parseReleaseManifest', () => {
  it('extracts version, asset URL, checksum and notes', () => {
    const result = parseReleaseManifest(release());
    expect(result.ok).toBe(true);
    expect(result.manifest).toMatchObject({
      version: '1.2.0',
      tag: 'v1.2.0',
      apkUrl: 'https://example.test/locus.apk',
      apkSize: 9_000_000,
      sha256: 'a'.repeat(64),
      mandatory: false,
      notes: 'Fixed the squad roster.',
    });
  });

  it('normalises the checksum to lower case and tolerates SHA-256 / = spellings', () => {
    const digest = 'A1B2'.repeat(16);
    const result = parseReleaseManifest(release({ body: `notes\nSHA-256 = ${digest}` }));
    expect(result.ok).toBe(true);
    expect(result.manifest.sha256).toBe(digest.toLowerCase());
  });

  it('flags a mandatory release', () => {
    const result = parseReleaseManifest(
      release({ body: `Critical fix.\n${MANDATORY_MARKER}\nSHA256: ${'d'.repeat(64)}` })
    );
    expect(result.ok).toBe(true);
    expect(result.manifest.mandatory).toBe(true);
    expect(result.manifest.notes).toBe('Critical fix.');
  });

  it('rejects a release with no checksum, so nothing unverified can ever install', () => {
    expect(parseReleaseManifest(release({ body: 'Just some notes.' }))).toEqual({
      ok: false,
      reason: 'MISSING_CHECKSUM',
    });
  });

  it('rejects a truncated checksum rather than treating it as valid', () => {
    expect(parseReleaseManifest(release({ body: `SHA256: ${'a'.repeat(63)}` }))).toEqual({
      ok: false,
      reason: 'MISSING_CHECKSUM',
    });
  });

  it('rejects a release with no APK attached', () => {
    expect(parseReleaseManifest(release({ assets: [{ name: 'source.zip', browser_download_url: 'x' }] }))).toEqual({
      ok: false,
      reason: 'MISSING_APK_ASSET',
    });
    expect(parseReleaseManifest(release({ assets: undefined }))).toEqual({
      ok: false,
      reason: 'MISSING_APK_ASSET',
    });
  });

  it('rejects drafts and unparseable tags', () => {
    expect(parseReleaseManifest(release({ draft: true }))).toEqual({ ok: false, reason: 'DRAFT_RELEASE' });
    expect(parseReleaseManifest(release({ tag_name: 'nightly' }))).toEqual({
      ok: false,
      reason: 'UNPARSEABLE_TAG',
    });
    expect(parseReleaseManifest(null)).toEqual({ ok: false, reason: 'MALFORMED_RELEASE' });
  });

  it('honours a custom asset name', () => {
    const custom = release({ assets: [{ name: 'other.apk', browser_download_url: 'https://x.test/o.apk' }] });
    expect(parseReleaseManifest(custom, { assetName: 'other.apk' }).ok).toBe(true);
  });
});

/**
 * Finding the latest NATIVE release in a repo that also carries JS bundle releases.
 *
 * Phase 1 used to read /releases/latest, which is whichever release was published most
 * recently across every tag series. The moment a js-* release was cut, that endpoint
 * started returning a tag parseVersion cannot read, the check failed closed, and an old
 * shell silently stopped being told that a real APK update existed — precisely the device
 * a [MANDATORY] release is aimed at. These pin the listing-and-filtering behaviour that
 * replaced it.
 */
describe('selectLatestApkRelease', () => {
  const bundleRelease = (overrides = {}) => ({
    tag_name: 'js-1.0.1',
    draft: false,
    prerelease: false,
    body: ['MIN_NATIVE: 1.0.0', 'SHA256: ' + 'b'.repeat(64)].join(String.fromCharCode(10)),
    assets: [{ name: 'locus-bundle.zip', browser_download_url: 'https://example.test/bundle.zip', size: 300_000 }],
    ...overrides,
  });

  it('ignores a newer js-* release and finds the v* one beneath it', () => {
    // The exact shape of the bug: GitHub lists newest-first, so the JS bundle comes
    // first and the real APK release sits behind it.
    const listing = [bundleRelease(), release({ tag_name: 'v1.2.0' })];
    expect(selectLatestApkRelease(listing)?.tag).toBe('v1.2.0');
  });

  it('still finds the APK release however many js-* releases are stacked on top', () => {
    const listing = [
      bundleRelease({ tag_name: 'js-1.2.4' }),
      bundleRelease({ tag_name: 'js-1.2.3' }),
      bundleRelease({ tag_name: 'js-1.2.2' }),
      release({ tag_name: 'v1.2.0' }),
    ];
    expect(selectLatestApkRelease(listing)?.version).toBe('1.2.0');
  });

  it('takes the highest version, not whatever GitHub listed first', () => {
    // Listing order follows publish date, so a republished or back-dated release would
    // otherwise be able to offer every device an older APK than it already runs.
    const listing = [release({ tag_name: 'v1.1.0' }), release({ tag_name: 'v1.10.0' })];
    expect(selectLatestApkRelease(listing)?.version).toBe('1.10.0');
  });

  it('skips drafts and prereleases, which /releases/latest used to exclude server-side', () => {
    expect(
      selectLatestApkRelease([release({ tag_name: 'v2.0.0', draft: true }), release({ tag_name: 'v1.2.0' })])?.tag,
    ).toBe('v1.2.0');
    expect(
      selectLatestApkRelease([release({ tag_name: 'v2.0.0', prerelease: true }), release({ tag_name: 'v1.2.0' })])?.tag,
    ).toBe('v1.2.0');
  });

  it('skips a v* release that would be rejected on its own merits', () => {
    const listing = [
      release({ tag_name: 'v2.0.0', body: 'no checksum here' }),
      release({ tag_name: 'v1.9.0', assets: [] }),
      release({ tag_name: 'v1.2.0' }),
    ];
    expect(selectLatestApkRelease(listing)?.tag).toBe('v1.2.0');
  });

  it('fails closed rather than throwing when nothing usable is there', () => {
    expect(selectLatestApkRelease([])).toBeNull();
    expect(selectLatestApkRelease([bundleRelease()])).toBeNull();
    expect(selectLatestApkRelease(null)).toBeNull();
    expect(selectLatestApkRelease([null, undefined, 42, {}])).toBeNull();
  });

  it('does not mistake a js- tag for a v* one on prefix alone', () => {
    // 'js-1.0.1' must not slip through any case-insensitive or substring matching.
    expect(selectLatestApkRelease([bundleRelease({ tag_name: 'JS-9.9.9' })])).toBeNull();
  });
});
