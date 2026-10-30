// Copying a release between repos (scripts/lib/mirrorRelease.mjs). gh is faked, with real files
// in a temp folder; nothing is published.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetNameForTag, mirrorRelease } from '../scripts/lib/mirrorRelease.mjs';
import { NEW_REPO, OLD_REPO } from '../scripts/lib/repos.mjs';

const BYTES = Buffer.from('pretend this is a bundle zip');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const BODY = `- a note\n\nMIN_NATIVE: 1.1.75\nSHA256: ${SHA}`;

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'locus-mirror-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A fake gh holding releases per repo; records calls and what was uploaded. */
function fakeGh({ tables, source = {}, downloaded = BYTES, extraFile = null, fail = null } = {}) {
  const calls = [];
  const uploads = [];
  const created = {};
  const releases = tables ?? { [OLD_REPO]: ['js-1.1.84', 'v1.1.75'], [NEW_REPO]: [] };
  const sourceRelease = {
    name: 'LOCUS JS bundle 1.1.84',
    body: BODY,
    isDraft: false,
    isPrerelease: false,
    assets: [
      { name: 'locus-bundle.zip', size: BYTES.length },
      { name: 'verification.json', size: 10 },
      { name: 'browser-verification.json', size: 10 },
    ],
    ...source,
  };
  const run = (args) => {
    calls.push(args);
    const repo = args[args.indexOf('--repo') + 1];
    const key = `${args[0]} ${args[1]}`;
    if (fail === key) return { status: 1, stderr: `${key} failed` };
    if (key === 'release list') return { status: 0, stdout: JSON.stringify(releases[repo].map((tagName) => ({ tagName, isDraft: false }))) };
    if (key === 'release view') {
      if (repo === OLD_REPO && args.includes('name,body,isDraft,isPrerelease,assets')) return { status: 0, stdout: JSON.stringify(sourceRelease) };
      if (args.includes('body')) return { status: 0, stdout: JSON.stringify({ body: created[repo] ?? '' }) };
      return { status: 1, stderr: 'release not found' }; // publishRelease: the tag is free in the target
    }
    if (key === 'release download') {
      const out = args[args.indexOf('--dir') + 1];
      writeFileSync(join(out, args[args.indexOf('--pattern') + 1]), downloaded);
      if (extraFile) writeFileSync(join(out, extraFile), 'x');
      return { status: 0, stdout: '' };
    }
    if (key === 'release create') {
      const file = args[3];
      uploads.push({ repo, name: basename(file), bytes: readFileSync(file) });
      created[repo] = readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
      return { status: 0, stdout: '' };
    }
    return { status: 0, stdout: '' };
  };
  return { run, calls, uploads };
}

const MIRROR = { from: OLD_REPO, to: NEW_REPO, tag: 'js-1.1.84' };
const go = (gh, extra = {}) => mirrorRelease({ ...MIRROR, run: gh.run, workDir: join(dir, 'w'), ...extra });

describe('copying a release', () => {
  it('copies the real asset byte for byte, with the same tag, title and body', () => {
    const gh = fakeGh();
    const result = go(gh);
    expect(result.ok).toBe(true);
    expect(gh.uploads).toEqual([{ repo: NEW_REPO, name: 'locus-bundle.zip', bytes: BYTES }]);
    const create = gh.calls.find((c) => c[1] === 'create');
    expect(create).toEqual(expect.arrayContaining(['js-1.1.84', '--repo', NEW_REPO, '--title', 'LOCUS JS bundle 1.1.84']));
    expect(result.report).toMatchObject({ sha256: SHA, minNative: '1.1.75', mandatory: false, bytes: BYTES.length });
    // Not a draft left behind: created as a draft, then published.
    expect(gh.calls.map((c) => c.slice(0, 2).join(' '))).toContain('release edit');
  });

  it('copies only the real asset: verification.json and the like never leave the source', () => {
    const gh = fakeGh();
    go(gh);
    const download = gh.calls.find((c) => c[1] === 'download');
    expect(download).toEqual(expect.arrayContaining(['--pattern', 'locus-bundle.zip']));
    expect(gh.uploads.map((u) => u.name)).toEqual(['locus-bundle.zip']);
    expect(gh.calls.flat().join(' ')).not.toMatch(/verification|update-index/);
  });

  it('refuses a download that holds anything besides the real asset', () => {
    const gh = fakeGh({ extraFile: 'verification.json' });
    expect(go(gh)).toMatchObject({ ok: false, error: expect.stringMatching(/expected exactly locus-bundle\.zip/) });
    expect(gh.uploads).toHaveLength(0);
  });

  it('aborts when the downloaded bytes do not hash to the SHA256 line of the body', () => {
    const gh = fakeGh({ downloaded: Buffer.from('tampered') });
    const result = go(gh);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/hashes to .* but the release body says/);
    expect(gh.calls.some((c) => c[1] === 'create')).toBe(false);
  });

  it('aborts when the body has no valid SHA256 line', () => {
    const gh = fakeGh({ source: { body: '- note only' } });
    expect(go(gh)).toMatchObject({ ok: false, error: expect.stringMatching(/no valid SHA256/) });
    expect(gh.uploads).toHaveLength(0);
  });

  it('refuses a tag that already exists in the target, instead of overwriting it', () => {
    const gh = fakeGh({ tables: { [OLD_REPO]: ['js-1.1.84'], [NEW_REPO]: ['js-1.1.84'] } });
    expect(go(gh)).toMatchObject({ ok: false, error: expect.stringMatching(/already exists in .*Locus-Release/) });
    expect(gh.calls.some((c) => c[1] === 'create' || c[1] === 'delete' || c[1] === 'edit')).toBe(false);
  });

  it('refuses a version below one already published in the same series, in either repo', () => {
    const gh = fakeGh({ tables: { [OLD_REPO]: ['js-1.1.84', 'js-1.1.83'], [NEW_REPO]: [] } });
    expect(go(gh, { tag: 'js-1.1.83' })).toMatchObject({ ok: false, error: expect.stringMatching(/below js-1\.1\.84/) });
    expect(gh.uploads).toHaveLength(0);
  });

  it('stops when either repo cannot be asked, rather than treating it as empty', () => {
    const gh = fakeGh({ fail: 'release list' });
    expect(go(gh).ok).toBe(false);
    expect(gh.uploads).toHaveLength(0);
  });

  it('a dry run downloads and checks, but creates nothing', () => {
    const gh = fakeGh();
    const result = go(gh, { dryRun: true });
    expect(result).toMatchObject({ ok: true, dryRun: true });
    expect(result.report.safeguard).toMatch(/^PASSED/);
    expect(gh.calls.some((c) => ['create', 'edit', 'upload', 'delete'].includes(c[1]))).toBe(false);
  });

  it('refuses a draft or pre-release, the same repo twice, and tags that are not releases', () => {
    expect(go(fakeGh({ source: { isPrerelease: true } })).ok).toBe(false);
    expect(go(fakeGh(), { to: OLD_REPO }).ok).toBe(false);
    expect(go(fakeGh(), { tag: 'update-index' }).ok).toBe(false);
    expect(assetNameForTag('v1.1.75')).toBe('locus-latest.apk');
    expect(assetNameForTag('js-1.1.84')).toBe('locus-bundle.zip');
  });

  it('never calls gh without naming a repo', () => {
    const gh = fakeGh();
    go(gh);
    for (const call of gh.calls.filter((c) => c[0] === 'release')) expect(call).toContain('--repo');
  });
});
