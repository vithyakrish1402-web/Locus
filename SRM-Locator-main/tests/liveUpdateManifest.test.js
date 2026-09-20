import { describe, it, expect } from 'vitest';
import {
  BUNDLE_ASSET_NAME,
  extractBundleNotes,
  isBundleCompatible,
  parseBundleRelease,
  selectLatestBundleRelease,
  shouldApplyBundle,
} from '../src/utils/liveUpdateManifest';

const bundleRelease = (overrides = {}) => ({
  tag_name: 'js-1.0.1',
  draft: false,
  body: `Tightened the marker status math.\n\nMIN_NATIVE: 1.0.0\nSHA256: ${'a'.repeat(64)}`,
  assets: [{ name: BUNDLE_ASSET_NAME, browser_download_url: 'https://example.test/bundle.zip', size: 310_000 }],
  ...overrides,
});

describe('parseBundleRelease', () => {
  it('reads the version, zip URL, checksum and MIN_NATIVE', () => {
    const result = parseBundleRelease(bundleRelease());
    expect(result.ok).toBe(true);
    expect(result.manifest).toMatchObject({
      version: '1.0.1',
      tag: 'js-1.0.1',
      zipUrl: 'https://example.test/bundle.zip',
      zipSize: 310_000,
      sha256: 'a'.repeat(64),
      minNative: '1.0.0',
      notes: 'Tightened the marker status math.',
    });
  });

  it('ignores native APK releases, which use a bare v* tag', () => {
    expect(parseBundleRelease(bundleRelease({ tag_name: 'v1.2.0' }))).toEqual({
      ok: false,
      reason: 'NOT_A_BUNDLE_RELEASE',
    });
  });

  it('refuses a bundle with no MIN_NATIVE, since nobody decided what it is safe on', () => {
    expect(parseBundleRelease(bundleRelease({ body: `notes\nSHA256: ${'b'.repeat(64)}` }))).toEqual({
      ok: false,
      reason: 'MISSING_MIN_NATIVE',
    });
  });

  it('refuses a bundle with no checksum', () => {
    expect(parseBundleRelease(bundleRelease({ body: 'notes\nMIN_NATIVE: 1.0.0' }))).toEqual({
      ok: false,
      reason: 'MISSING_CHECKSUM',
    });
  });

  it('refuses a release with no zip attached, and drafts', () => {
    expect(parseBundleRelease(bundleRelease({ assets: [] }))).toEqual({
      ok: false,
      reason: 'MISSING_BUNDLE_ASSET',
    });
    expect(parseBundleRelease(bundleRelease({ draft: true }))).toEqual({ ok: false, reason: 'DRAFT_RELEASE' });
  });

  it('normalises a partial MIN_NATIVE to three parts', () => {
    const result = parseBundleRelease(bundleRelease({ body: `MIN_NATIVE: v2\nSHA256: ${'c'.repeat(64)}` }));
    expect(result.manifest.minNative).toBe('2.0.0');
  });
});

describe('extractBundleNotes', () => {
  it('strips both machine-readable lines', () => {
    const notes = extractBundleNotes(`Human text.\nMIN_NATIVE: 1.0.0\nSHA256: ${'d'.repeat(64)}\nMore text.`);
    expect(notes).toBe('Human text.\nMore text.');
  });
});

describe('selectLatestBundleRelease', () => {
  it('picks the highest version, not whatever GitHub listed first', () => {
    const latest = selectLatestBundleRelease([
      bundleRelease({ tag_name: 'js-1.0.9' }),
      bundleRelease({ tag_name: 'js-1.2.0' }),
      bundleRelease({ tag_name: 'js-1.0.10' }),
    ]);
    expect(latest.version).toBe('1.2.0');
  });

  it('skips native releases and malformed bundles mixed into the listing', () => {
    const latest = selectLatestBundleRelease([
      { tag_name: 'v9.0.0', assets: [], body: '' },
      bundleRelease({ tag_name: 'js-2.0.0', body: 'no markers at all' }),
      bundleRelease({ tag_name: 'js-1.0.1' }),
    ]);
    expect(latest.version).toBe('1.0.1');
  });

  it('returns null when there is nothing usable', () => {
    expect(selectLatestBundleRelease([])).toBeNull();
    expect(selectLatestBundleRelease(null)).toBeNull();
  });
});

describe('isBundleCompatible', () => {
  it('allows a shell at or above MIN_NATIVE', () => {
    expect(isBundleCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(isBundleCompatible('1.4.0', '1.0.0')).toBe(true);
  });

  it('blocks a shell below MIN_NATIVE', () => {
    expect(isBundleCompatible('1.0.0', '1.1.0')).toBe(false);
    expect(isBundleCompatible('0.9.9', '1.0.0')).toBe(false);
  });

  it('fails closed on an unreadable version', () => {
    expect(isBundleCompatible(null, '1.0.0')).toBe(false);
    expect(isBundleCompatible('1.0.0', 'unknown')).toBe(false);
  });
});

describe('shouldApplyBundle', () => {
  const manifest = { version: '1.0.2', minNative: '1.0.0', sha256: 'x', zipUrl: 'u' };

  it('applies a newer, compatible bundle', () => {
    expect(
      shouldApplyBundle({ nativeVersion: '1.0.0', currentBundleVersion: '1.0.1', manifest })
    ).toEqual({ apply: true, reason: 'UPDATE_AVAILABLE' });
  });

  it('treats the builtin bundle as the native version', () => {
    // Fresh APK install: nothing downloaded yet, so "builtin" means "whatever 1.0.0 shipped".
    expect(shouldApplyBundle({ nativeVersion: '1.0.0', currentBundleVersion: 'builtin', manifest })).toEqual({
      apply: true,
      reason: 'UPDATE_AVAILABLE',
    });
    // ...and a bundle at or below that native version is already in the APK.
    expect(
      shouldApplyBundle({
        nativeVersion: '1.0.2',
        currentBundleVersion: 'builtin',
        manifest,
      })
    ).toEqual({ apply: false, reason: 'ALREADY_CURRENT' });
  });

  it('BLOCKS a bundle whose MIN_NATIVE is above the installed shell', () => {
    // The acceptance case: a bundle needing a native capability this shell lacks must be
    // refused, not applied and broken. The user is sent to the Phase 1 APK update instead.
    expect(
      shouldApplyBundle({
        nativeVersion: '1.0.0',
        currentBundleVersion: 'builtin',
        manifest: { ...manifest, version: '2.0.0', minNative: '1.1.0' },
      })
    ).toEqual({ apply: false, reason: 'NATIVE_TOO_OLD' });
  });

  it('prefers the compatibility gate over the newness check', () => {
    // A much newer bundle is still refused by an old shell — "newer" never overrides
    // "incompatible".
    const result = shouldApplyBundle({
      nativeVersion: '1.0.0',
      currentBundleVersion: '1.0.0',
      manifest: { ...manifest, version: '99.0.0', minNative: '5.0.0' },
    });
    expect(result.apply).toBe(false);
    expect(result.reason).toBe('NATIVE_TOO_OLD');
  });

  it('does nothing when the running bundle is already current or newer', () => {
    expect(shouldApplyBundle({ nativeVersion: '1.0.0', currentBundleVersion: '1.0.2', manifest })).toEqual({
      apply: false,
      reason: 'ALREADY_CURRENT',
    });
    expect(shouldApplyBundle({ nativeVersion: '1.0.0', currentBundleVersion: '1.9.0', manifest })).toEqual({
      apply: false,
      reason: 'ALREADY_CURRENT',
    });
  });

  it('does nothing when no bundle has been published', () => {
    expect(shouldApplyBundle({ nativeVersion: '1.0.0', currentBundleVersion: 'builtin', manifest: null })).toEqual({
      apply: false,
      reason: 'NO_BUNDLE_PUBLISHED',
    });
  });
});
