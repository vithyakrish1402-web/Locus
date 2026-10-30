// The two-repo release setup (scripts/lib/repos.mjs): where a release is published is always
// said out loud, the version rule looks at both repos, a repo that can't be asked stops the run,
// and the update index is built with the links of the repo it is built for. gh is faked.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NEW_REPO,
  OLD_REPO,
  mirrorVersionProblem,
  originRepo,
  publishedTagsOfRepos,
  tagsBuiltCommit,
  targetRepo,
} from '../scripts/lib/repos.mjs';
import { publishUpdateIndex } from '../scripts/lib/updateIndex.mjs';
import { publishRelease } from '../scripts/lib/publishRelease.mjs';
import { releaseVersionConflict } from '../src/utils/liveUpdateManifest.js';
import { isOwnReleaseLink, parseUpdateIndex } from '../src/utils/updateIndex.js';

const SHA = 'a'.repeat(64);
const NOW = Date.parse('2026-10-13T12:00:00Z');

describe('the target repo of a publish', () => {
  it('is refused when nobody said where, instead of guessing', () => {
    const result = targetRepo([], {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no target repo/);
  });

  it('comes from --repo (either spelling) or UPDATE_REPO, and is checked for shape', () => {
    expect(targetRepo(['1.2.3', '--repo', NEW_REPO], {})).toEqual({ ok: true, repo: NEW_REPO });
    expect(targetRepo([`--repo=${OLD_REPO}`], {})).toEqual({ ok: true, repo: OLD_REPO });
    expect(targetRepo([], { UPDATE_REPO: NEW_REPO })).toEqual({ ok: true, repo: NEW_REPO });
    // The flag wins over the environment.
    expect(targetRepo(['--repo', OLD_REPO], { UPDATE_REPO: NEW_REPO })).toEqual({ ok: true, repo: OLD_REPO });
    expect(targetRepo(['--repo', 'not a repo'], {}).ok).toBe(false);
    expect(targetRepo(['--repo'], {}).ok).toBe(false);
  });

  it('is never taken from origin: only the repo the source lives in gets the built commit as its tag', () => {
    expect(tagsBuiltCommit(OLD_REPO, OLD_REPO)).toBe(true);
    expect(tagsBuiltCommit(OLD_REPO.toLowerCase(), OLD_REPO)).toBe(true);
    expect(tagsBuiltCommit(NEW_REPO, OLD_REPO)).toBe(false);
    expect(tagsBuiltCommit(OLD_REPO, null)).toBe(false);
    expect(typeof originRepo).toBe('function');
  });
});

/** A fake gh answering `release list --repo X` from a table of repo -> tags (or an error). */
const listing = (table) => (args) => {
  const repo = args[args.indexOf('--repo') + 1];
  const entry = table[repo];
  if (entry instanceof Error) throw entry;
  if (entry && entry.fail) return { status: 1, stdout: '', stderr: entry.fail };
  if (entry && entry.raw !== undefined) return { status: 0, stdout: entry.raw };
  return { status: 0, stdout: JSON.stringify((entry ?? []).map((tagName) => ({ tagName, isDraft: false }))) };
};

describe('the version rule across both repos', () => {
  const OLD_TAGS = ['js-1.1.84', 'js-1.1.83', 'v1.1.75', 'v1.1.73'];

  it('with the new repo empty and the old one full, a lower version is refused and a higher one allowed', () => {
    const published = publishedTagsOfRepos(listing({ [OLD_REPO]: OLD_TAGS, [NEW_REPO]: [] }));
    expect(published.ok).toBe(true);
    expect(published.tags).toEqual(OLD_TAGS);
    // The js-1.0.9 failure mode: asked of the empty repo alone, anything would pass.
    expect(releaseVersionConflict('1.0.9', [])).toBeNull();
    expect(releaseVersionConflict('1.0.9', published.tags)).toMatch(/not above 1\.1\.84/);
    expect(releaseVersionConflict('1.1.84', published.tags)).toMatch(/not above/);
    expect(releaseVersionConflict('1.1.85', published.tags)).toBeNull();
  });

  it('counts a release that only the new repo has', () => {
    const published = publishedTagsOfRepos(listing({ [OLD_REPO]: ['js-1.1.84'], [NEW_REPO]: ['js-1.1.90'] }));
    expect(releaseVersionConflict('1.1.88', published.tags)).toMatch(/not above 1\.1\.90/);
  });

  it('an empty repo is a valid answer, even when both are empty', () => {
    expect(publishedTagsOfRepos(listing({}))).toMatchObject({ ok: true, tags: [] });
  });

  it('drafts are not counted', () => {
    const run = () => ({ status: 0, stdout: JSON.stringify([{ tagName: 'js-9.9.9', isDraft: true }, { tagName: 'js-1.0.0', isDraft: false }]) });
    expect(publishedTagsOfRepos(run).tags).toEqual(['js-1.0.0', 'js-1.0.0']);
  });

  it.each([
    ['a failed query (not found)', { [OLD_REPO]: ['v1.0.0'], [NEW_REPO]: { fail: 'HTTP 404: Not Found' } }],
    ['a failed query on the old repo (no permission)', { [OLD_REPO]: { fail: 'HTTP 403' }, [NEW_REPO]: [] }],
    ['a network error that throws', { [OLD_REPO]: new Error('spawn gh ENOENT') }],
    ['an answer that is not JSON', { [OLD_REPO]: { raw: '<html>' } }],
    ['an answer that is not a list', { [OLD_REPO]: { raw: '{"message":"x"}' } }],
  ])('fails closed on %s: nothing comes back that looks like "nothing published"', (_, table) => {
    const published = publishedTagsOfRepos(listing(table));
    expect(published.ok).toBe(false);
    expect(published.error).toMatch(/Nothing was published|could not list/);
    expect(published.tags).toBeUndefined();
  });

  it('fails closed on a list as long as the limit, which may be cut off', () => {
    const run = () => ({ status: 0, stdout: JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ tagName: `js-1.0.${i}`, isDraft: false }))) });
    expect(publishedTagsOfRepos(run).ok).toBe(false);
  });

  it('a copy must not be below a published release of its own series, in either repo', () => {
    const tags = ['js-1.1.84', 'js-1.1.83', 'v1.1.75'];
    expect(mirrorVersionProblem('js-1.1.84', tags)).toBeNull();
    expect(mirrorVersionProblem('v1.1.75', tags)).toBeNull();
    expect(mirrorVersionProblem('js-1.1.83', tags)).toMatch(/below js-1\.1\.84/);
    expect(mirrorVersionProblem('v1.1.73', tags)).toMatch(/below v1\.1\.75/);
    expect(mirrorVersionProblem('weird', tags)).toMatch(/not a v\* or js-\* release tag/);
  });
});

describe('the update index is built with the links of the repo it is built for', () => {
  const link = (repo, tag, name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;
  const listingFor = (repo) => [
    { id: 3, tag_name: 'update-index', draft: false, prerelease: true, body: '', assets: [{ id: 30, name: 'update-index.json', browser_download_url: link(repo, 'update-index', 'update-index.json'), size: 9 }] },
    { id: 2, tag_name: 'js-1.1.84', draft: false, prerelease: false, body: `MIN_NATIVE: 1.1.75\nSHA256: ${SHA}`, assets: [{ id: 20, name: 'locus-bundle.zip', browser_download_url: link(repo, 'js-1.1.84', 'locus-bundle.zip'), size: 1048576 }] },
    { id: 1, tag_name: 'v1.1.75', draft: false, prerelease: false, body: `SHA256: ${SHA}`, assets: [{ id: 10, name: 'locus-latest.apk', browser_download_url: link(repo, 'v1.1.75', 'locus-latest.apk'), size: 5036092 }] },
  ];
  const fakeGh = (listing) => {
    const calls = [];
    const run = (args) => {
      calls.push(args);
      if (args[0] === 'api') return { status: 0, stdout: JSON.stringify(listing) };
      if (args[0] === 'release' && args[1] === 'view') return { status: 0, stdout: '{"tagName":"update-index"}' };
      return { status: 0, stdout: '' };
    };
    return { run, calls };
  };
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locus-repo-move-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([[OLD_REPO, NEW_REPO], [NEW_REPO, OLD_REPO]])(
    'built for %s: every link is its own, uploaded to it, and the other repo would reject the file',
    (repo, other) => {
      const gh = fakeGh(listingFor(repo));
      const result = publishUpdateIndex({ dir, repo, run: gh.run, now: NOW });
      expect(result.ok).toBe(true);
      const file = JSON.parse(readFileSync(result.file, 'utf8'));
      const links = file.releases.flatMap((r) => r.assets.map((a) => a.browser_download_url));
      expect(links.length).toBeGreaterThan(0);
      for (const l of links) {
        expect(l.startsWith(`https://github.com/${repo}/releases/download/`)).toBe(true);
        expect(isOwnReleaseLink(l, repo)).toBe(true);
        expect(isOwnReleaseLink(l, other)).toBe(false);
      }
      // A phone running JS compiled for the other repo refuses this file...
      expect(parseUpdateIndex(file, { repo: other, now: NOW })).toEqual({ ok: false, reason: 'FOREIGN_LINK' });
      // ...and one compiled for this repo accepts it.
      expect(parseUpdateIndex(file, { repo, now: NOW }).ok).toBe(true);
      // Every call asked for this repo and no other.
      expect(gh.calls[0]).toContain(`repos/${repo}/releases?per_page=100`);
      expect(gh.calls.filter((c) => c[0] === 'release').every((c) => c[c.indexOf('--repo') + 1] === repo)).toBe(true);
    }
  );

  it("never builds one repo's index from the other's releases: the app's own check refuses it", () => {
    const gh = fakeGh(listingFor(OLD_REPO));
    const result = publishUpdateIndex({ dir, repo: NEW_REPO, run: gh.run, now: NOW });
    expect(result).toMatchObject({ ok: false, step: 'check the new file the way the app does', error: 'FOREIGN_LINK' });
    expect(gh.calls.some((c) => c[1] === 'upload' || c[1] === 'create')).toBe(false);
  });

  it('is refused when no repo is given', () => {
    const gh = fakeGh(listingFor(OLD_REPO));
    expect(publishUpdateIndex({ dir, run: gh.run, now: NOW })).toMatchObject({ ok: false, error: 'no target repo' });
    expect(gh.calls).toHaveLength(0);
  });
});

describe('publishing a release', () => {
  const base = { tag: 'js-1.1.85', title: 'T', asset: 'a.zip', notesFile: 'n.md' };
  const fake = () => {
    const calls = [];
    return { calls, run: (args) => (calls.push(args), args[1] === 'view' ? { status: 1, stderr: 'not found' } : { status: 0, stdout: 'BUILT\n' }) };
  };

  it('is refused with no target repo, and calls nothing', () => {
    const gh = fake();
    expect(publishRelease({ ...base, target: 'BUILT', run: gh.run })).toMatchObject({ ok: false, step: 'choose the repo' });
    expect(gh.calls).toHaveLength(0);
  });

  it('names the repo in every gh call', () => {
    const gh = fake();
    publishRelease({ ...base, target: 'BUILT', repo: OLD_REPO, run: gh.run });
    for (const call of gh.calls.filter((c) => c[0] === 'release')) expect(call[call.indexOf('--repo') + 1]).toBe(OLD_REPO);
    expect(gh.calls.at(-1)[1]).toBe(`repos/${OLD_REPO}/git/ref/tags/js-1.1.85`);
    // The repo the source lives in still gets its tag on the built commit.
    expect(gh.calls.find((c) => c[1] === 'create')).toEqual(expect.arrayContaining(['--target', 'BUILT']));
  });

  it('in a releases-only repo (no built commit) sets no --target and does not compare the tag', () => {
    const gh = fake();
    expect(publishRelease({ ...base, target: null, repo: NEW_REPO, run: gh.run })).toEqual({ ok: true });
    expect(gh.calls.flat()).not.toContain('--target');
    expect(gh.calls.some((c) => c[0] === 'api')).toBe(false);
  });
});

describe('no release script depends on origin', () => {
  it.each(['release.mjs', 'release-bundle.mjs', 'release-index.mjs', 'verify-release.mjs', 'mirror-release.mjs', 'lib/updateIndex.mjs', 'lib/publishRelease.mjs', 'lib/mirrorRelease.mjs', 'lib/repos.mjs'])(
    '%s: every gh release call names its repo',
    (name) => {
      const source = readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
      const lines = source.split(/\r?\n/).filter((l) => /\[\s*'release'\s*,/.test(l) && !/^\s*\/\//.test(l));
      for (const line of lines) expect(line).toMatch(/--repo|inRepo/);
      expect(source).not.toMatch(/repos\/\{owner\}\/\{repo\}/);
    }
  );

  it('the release scripts refuse to run without a target and read both repos', () => {
    for (const name of ['release.mjs', 'release-bundle.mjs']) {
      const source = readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
      expect(source).toContain('targetRepo(argv)');
      expect(source).toContain('publishedTagsOfRepos(ghRun)');
      expect(source).toMatch(/if \(!publishedAll\.ok\) die\(/);
    }
  });
});
