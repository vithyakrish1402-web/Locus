// The update index (src/utils/updateIndex.js): the releases list as a file on a release of its
// own, which a launch reads without spending GitHub's 60-an-hour anonymous allowance. The app
// trusts it only when every check passes; on any doubt it asks the API listing instead.
import { describe, expect, it } from 'vitest';
import {
  UPDATE_INDEX_ASSET_NAME,
  UPDATE_INDEX_FORMAT_VERSION,
  UPDATE_INDEX_FUTURE_TOLERANCE_HOURS,
  UPDATE_INDEX_MAX_AGE_HOURS,
  UPDATE_INDEX_RELEASE_COUNT,
  UPDATE_INDEX_TAG,
  buildUpdateIndex,
  isOwnReleaseLink,
  parseUpdateIndex,
  updateIndexUrl,
} from '../src/utils/updateIndex.js';
import { selectInstallerRelease, selectLatestApkRelease } from '../src/utils/updateManifest.js';
import { releaseVersionConflict, selectLatestBundleRelease } from '../src/utils/liveUpdateManifest.js';

const REPO = 'vithyakrish1402-web/Locus';
const SHA = 'a'.repeat(64);
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-13T12:00:00Z');
const link = (tag, name) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
const apk = (version, extra = {}) => ({
  tag_name: `v${version}`,
  prerelease: false,
  body: `- What changed\n\nSHA256: ${SHA}`,
  assets: [{ name: 'locus-latest.apk', browser_download_url: link(`v${version}`, 'locus-latest.apk'), size: 5036092 }],
  ...extra,
});
const bundle = (version, extra = {}) => ({
  tag_name: `js-${version}`,
  prerelease: false,
  body: `- What changed\n\nMIN_NATIVE: 1.1.21\nSHA256: ${SHA}`,
  assets: [{ name: 'locus-bundle.zip', browser_download_url: link(`js-${version}`, 'locus-bundle.zip'), size: 1048576 }],
  ...extra,
});
const RELEASES = [bundle('1.1.24'), bundle('1.1.23'), apk('1.1.21'), bundle('1.1.20'), apk('1.1.0')];
const file = (overrides = {}) => ({
  formatVersion: 1,
  generatedAt: new Date(NOW - HOUR).toISOString(),
  releases: RELEASES,
  ...overrides,
});
const check = (data, now = NOW) => parseUpdateIndex(data, { repo: REPO, now });

describe('a good file', () => {
  it('is trusted, and its releases are handed on as they are', () => {
    const data = file();
    expect(check(data)).toEqual({ ok: true, releases: data.releases });
    expect(check(data).releases).toBe(data.releases);
  });

  it("the app's own checks pick the same releases from it as from GitHub's listing", () => {
    const { releases } = check(file());
    expect(selectLatestApkRelease(releases).tag).toBe('v1.1.21');
    expect(selectLatestBundleRelease(releases).tag).toBe('js-1.1.24');
    expect(selectInstallerRelease(releases, '1.1.0').tag).toBe('v1.1.0');
  });

  it('lives at a fixed address on the update-index release, with a fresh-copy marker', () => {
    expect(UPDATE_INDEX_TAG).toBe('update-index');
    expect(UPDATE_INDEX_FORMAT_VERSION).toBe(1);
    expect(updateIndexUrl(REPO, 1791864955123)).toBe(
      `https://github.com/${REPO}/releases/download/update-index/${UPDATE_INDEX_ASSET_NAME}?t=1791864955123`
    );
    expect(UPDATE_INDEX_ASSET_NAME).toBe('update-index.json');
  });
});

describe('not trusted: malformed or an unknown format', () => {
  it('anything but an object', () => {
    for (const data of [null, undefined, 'text', 42, [], RELEASES]) expect(check(data)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('a format version other than 1', () => {
    for (const formatVersion of [2, 0, '1', undefined, null]) {
      expect(check(file({ formatVersion }))).toEqual({ ok: false, reason: 'UNKNOWN_FORMAT' });
    }
  });

  it('no readable generated-at time', () => {
    for (const generatedAt of [undefined, '', 'yesterday', 1791864955000, null]) {
      expect(check(file({ generatedAt }))).toEqual({ ok: false, reason: 'MALFORMED' });
    }
  });

  it('releases that are not a list, or an entry that is not a release', () => {
    expect(check(file({ releases: undefined })).reason).toBe('MALFORMED');
    expect(check(file({ releases: {} })).reason).toBe('MALFORMED');
    expect(check(file({ releases: [...RELEASES, null] })).reason).toBe('MALFORMED');
    expect(check(file({ releases: [...RELEASES, 'v1.2.0'] })).reason).toBe('MALFORMED');
    expect(check(file({ releases: [...RELEASES, { ...apk('1.0.0'), assets: undefined }] })).reason).toBe('MALFORMED');
    expect(check(file({ releases: [...RELEASES, { ...apk('1.0.0'), assets: [null] }] })).reason).toBe('MALFORMED');
    expect(check(file({ releases: [...RELEASES, { ...apk('1.0.0'), assets: [{ name: 'locus-latest.apk' }] }] })).reason).toBe('MALFORMED');
  });
});

describe('not trusted: too old, or dated in the future', () => {
  it(`older than ${UPDATE_INDEX_MAX_AGE_HOURS} hours (30 days) is ignored`, () => {
    expect(UPDATE_INDEX_MAX_AGE_HOURS).toBe(720);
    const at = (ms) => file({ generatedAt: new Date(NOW - ms).toISOString() });
    expect(check(at(720 * HOUR)).ok).toBe(true);
    expect(check(at(720 * HOUR + 1000))).toEqual({ ok: false, reason: 'TOO_OLD' });
  });

  it(`dated more than ${UPDATE_INDEX_FUTURE_TOLERANCE_HOURS} hours ahead of the phone's clock is ignored`, () => {
    expect(UPDATE_INDEX_FUTURE_TOLERANCE_HOURS).toBe(24);
    const at = (ms) => file({ generatedAt: new Date(NOW + ms).toISOString() });
    // A clock a few hours behind (set by hand in the wrong time zone) still trusts it.
    expect(check(at(14 * HOUR)).ok).toBe(true);
    expect(check(at(24 * HOUR)).ok).toBe(true);
    expect(check(at(24 * HOUR + 1000))).toEqual({ ok: false, reason: 'FUTURE_DATED' });
  });
});

describe("not trusted: a download link outside this project's releases", () => {
  const withLink = (url, name = 'locus-latest.apk') =>
    file({ releases: [...RELEASES, { ...apk('1.0.0'), assets: [{ name, browser_download_url: url, size: 1 }] }] });

  it.each([
    ['another repo', 'https://github.com/someone-else/Locus/releases/download/v1.0.0/locus-latest.apk'],
    ['another host', 'https://evil.example/vithyakrish1402-web/Locus/releases/download/v1.0.0/locus-latest.apk'],
    ['a look-alike host', 'https://github.com.evil.example/vithyakrish1402-web/Locus/releases/download/v1.0.0/locus-latest.apk'],
    ['a host that merely ends in github.com', 'https://evilgithub.com/vithyakrish1402-web/Locus/releases/download/v1.0.0/locus-latest.apk'],
    ['a GitHub subdomain', 'https://uploads.github.com/vithyakrish1402-web/Locus/releases/download/v1.0.0/locus-latest.apk'],
    ['a host hidden behind a user name', 'https://github.com@evil.example/vithyakrish1402-web/Locus/releases/download/v1.0.0/locus-latest.apk'],
    ['plain http', 'http://github.com/vithyakrish1402-web/Locus/releases/download/v1.0.0/locus-latest.apk'],
    ['the storage server directly', 'https://release-assets.githubusercontent.com/github-production-release-asset/1/abc'],
    ['another part of the repo', 'https://github.com/vithyakrish1402-web/Locus/archive/refs/heads/main.zip'],
    ['"../" out of the releases', 'https://github.com/vithyakrish1402-web/Locus/releases/download/../../../evil/x.apk'],
    ['an encoded "../"', 'https://github.com/vithyakrish1402-web/Locus/releases/download/%2e%2e/%2e%2e/%2e%2e/evil/x.apk'],
    ['a repo whose name starts the same', 'https://github.com/vithyakrish1402-web/Locus-fork/releases/download/v1.0.0/locus-latest.apk'],
    ['not a link at all', 'locus-latest.apk'],
  ])('%s', (_, url) => {
    expect(check(withLink(url))).toEqual({ ok: false, reason: 'FOREIGN_LINK' });
  });

  it('even on a file the update checks would never download', () => {
    expect(check(withLink('https://evil.example/notes.txt', 'notes.txt'))).toEqual({ ok: false, reason: 'FOREIGN_LINK' });
  });

  it('GitHub names are not case-sensitive', () => {
    expect(isOwnReleaseLink('https://github.com/VithyaKrish1402-Web/locus/releases/download/v1.0.0/locus-latest.apk', REPO)).toBe(true);
    expect(isOwnReleaseLink(link('v1.0.0', 'locus-latest.apk'), REPO)).toBe(true);
    expect(isOwnReleaseLink(link('v1.0.0', 'locus-latest.apk'), '')).toBe(false);
  });
});

describe('not trusted: no usable app release, or no usable JS release', () => {
  it('without a usable v* release', () => {
    const bundles = RELEASES.filter((r) => r.tag_name.startsWith('js-'));
    expect(check(file({ releases: bundles }))).toEqual({ ok: false, reason: 'NO_USABLE_APK' });
    // Present, but not one the app would offer: no checksum, or only a pre-release.
    expect(check(file({ releases: [...bundles, apk('1.1.21', { body: 'no checksum' })] })).reason).toBe('NO_USABLE_APK');
    expect(check(file({ releases: [...bundles, apk('1.1.21', { prerelease: true })] })).reason).toBe('NO_USABLE_APK');
  });

  it('without a usable js-* release', () => {
    const apks = RELEASES.filter((r) => r.tag_name.startsWith('v'));
    expect(check(file({ releases: apks }))).toEqual({ ok: false, reason: 'NO_USABLE_BUNDLE' });
    expect(check(file({ releases: [...apks, bundle('1.1.24', { body: `SHA256: ${SHA}` })] })).reason).toBe('NO_USABLE_BUNDLE');
  });
});

// GitHub's own listing, as `gh api` and the anonymous API return it: far more than the app reads.
const github = (release, extra = {}) => ({
  url: `https://api.github.com/repos/${REPO}/releases/1`,
  id: 1,
  author: { login: 'vithyakrish1402-web' },
  draft: false,
  published_at: '2026-10-12T18:12:16Z',
  ...release,
  assets: release.assets.map((asset) => ({
    url: 'https://api.github.com/repos/x/y/releases/assets/9',
    id: 9,
    uploader: { login: 'vithyakrish1402-web' },
    content_type: 'application/zip',
    download_count: 12,
    ...asset,
  })),
  ...extra,
});

describe('building the file from the real releases', () => {
  it('keeps exactly the fields the update checks read, laid out like GitHub', () => {
    const index = buildUpdateIndex(RELEASES.map((r) => github(r)), { now: NOW });
    expect(index.formatVersion).toBe(1);
    expect(index.generatedAt).toBe('2026-10-13T12:00:00.000Z');
    expect(index.releases).toEqual(RELEASES);
    expect(Object.keys(index.releases[0]).sort()).toEqual(['assets', 'body', 'prerelease', 'tag_name']);
    expect(Object.keys(index.releases[0].assets[0]).sort()).toEqual(['browser_download_url', 'name', 'size']);
    expect(check(JSON.parse(JSON.stringify(index)))).toEqual({ ok: true, releases: RELEASES });
  });

  it("leaves out drafts, other tags, and files the update checks don't read", () => {
    const listing = [
      github({ tag_name: 'update-index', prerelease: true, body: '', assets: [{ name: 'update-index.json', browser_download_url: link('update-index', 'update-index.json') }] }),
      github(bundle('1.1.25'), { draft: true }),
      github({ tag_name: 'nightly', prerelease: false, body: '', assets: [] }),
      github({ ...apk('1.1.21'), assets: [...apk('1.1.21').assets, { name: 'notes.txt', browser_download_url: link('v1.1.21', 'notes.txt'), size: 3 }] }),
      github(bundle('1.1.24')),
    ];
    expect(buildUpdateIndex(listing, { now: NOW }).releases).toEqual([apk('1.1.21'), bundle('1.1.24')]);
  });

  it(`keeps GitHub's order and stops at the newest ${UPDATE_INDEX_RELEASE_COUNT}, like the listing the app reads`, () => {
    expect(UPDATE_INDEX_RELEASE_COUNT).toBe(30);
    const listing = Array.from({ length: 40 }, (_, i) => github(bundle(`1.0.${40 - i}`)));
    const { releases } = buildUpdateIndex(listing, { now: NOW });
    expect(releases).toHaveLength(30);
    expect(releases[0].tag_name).toBe('js-1.0.40');
    expect(releases[29].tag_name).toBe('js-1.0.11');
  });

  it('keeps the pre-release flag, so the update checks still skip a test release', () => {
    const listing = [github(apk('1.1.22', { prerelease: true })), github(apk('1.1.21')), github(bundle('1.1.24'))];
    const { releases } = buildUpdateIndex(listing, { now: NOW });
    expect(releases[0].prerelease).toBe(true);
    expect(selectLatestApkRelease(releases).tag).toBe('v1.1.21');
  });

  it('picks releases with the same tag test as the update checks (an upper-case V counts)', () => {
    const upper = { ...apk('1.1.22'), tag_name: 'V1.1.22' };
    expect(selectLatestApkRelease([upper]).version).toBe('1.1.22');
    expect(buildUpdateIndex([github(upper)], { now: NOW }).releases.map((r) => r.tag_name)).toEqual(['V1.1.22']);
  });

  it('a body GitHub left empty is an empty string, as the parsers read it', () => {
    expect(buildUpdateIndex([github({ ...apk('1.1.21'), body: null })], { now: NOW }).releases[0].body).toBe('');
  });

  it('refuses something that is not a list', () => {
    expect(() => buildUpdateIndex({ message: 'Not Found' })).toThrow('not a list');
  });
});

describe('the update-index release is never taken for a LOCUS release', () => {
  // As published (a pre-release), and a worst case: not a pre-release, carrying files and lines
  // shaped exactly like a real release's.
  const asPublished = { tag_name: UPDATE_INDEX_TAG, draft: false, prerelease: true, body: 'The list of current LOCUS releases.', assets: [{ name: 'update-index.json', browser_download_url: link('update-index', 'update-index.json'), size: 30000 }] };
  const lookalike = {
    tag_name: UPDATE_INDEX_TAG,
    draft: false,
    prerelease: false,
    body: `MIN_NATIVE: 1.1.0\nSHA256: ${SHA}`,
    assets: [
      { name: 'locus-latest.apk', browser_download_url: link('update-index', 'locus-latest.apk'), size: 1 },
      { name: 'locus-bundle.zip', browser_download_url: link('update-index', 'locus-bundle.zip'), size: 1 },
    ],
  };

  it.each([['as published', asPublished], ['even a look-alike', lookalike]])('by the update checks (%s)', (_, release) => {
    expect(selectLatestApkRelease([release])).toBeNull();
    expect(selectLatestBundleRelease([release])).toBeNull();
    expect(selectLatestApkRelease([release, ...RELEASES]).tag).toBe('v1.1.21');
    expect(selectLatestBundleRelease([release, ...RELEASES]).tag).toBe('js-1.1.24');
  });

  it.each([['as published', asPublished], ['even a look-alike', lookalike]])('by Send LOCUS (%s)', (_, release) => {
    expect(selectInstallerRelease([release], '1.1.21')).toBeNull();
    expect(selectInstallerRelease([release], null)).toBeNull();
    expect(selectInstallerRelease([release, ...RELEASES], '1.1.0').tag).toBe('v1.1.0');
  });

  it('by the release-number safeguard', () => {
    const published = ['update-index', 'js-1.1.23', 'v1.1.21'];
    expect(releaseVersionConflict('1.1.24', published)).toBeNull();
    expect(releaseVersionConflict('1.1.23', published)).toMatch(/1\.1\.23 is not above 1\.1\.23/);
    expect(releaseVersionConflict('1.1.24', ['update-index'])).toBeNull();
  });

  it('by the file itself', () => {
    expect(buildUpdateIndex([github(asPublished), github(lookalike), github(bundle('1.1.24'))], { now: NOW }).releases).toEqual([bundle('1.1.24')]);
  });
});
