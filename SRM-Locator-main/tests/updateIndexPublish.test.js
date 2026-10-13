// Rebuilding the update index (scripts/lib/updateIndex.mjs): the last step of both release
// scripts, and `npm run release:index`. It lists the real releases, builds the file, checks it
// the way the app will, and uploads it. A failure is loud and says how to fix it, but never
// throws: the release before it has already happened and must not be undone or failed.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishUpdateIndex, reportUpdateIndex, UPDATE_INDEX_FIX_COMMAND } from '../scripts/lib/updateIndex.mjs';
import { parseUpdateIndex } from '../src/utils/updateIndex.js';

const REPO = 'vithyakrish1402-web/Locus';
const SHA = 'a'.repeat(64);
const NOW = Date.parse('2026-10-13T12:00:00Z');
const link = (tag, name) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
const LISTING = [
  { id: 3, tag_name: 'update-index', draft: false, prerelease: true, body: '', assets: [{ id: 30, name: 'update-index.json', browser_download_url: link('update-index', 'update-index.json'), size: 9 }] },
  { id: 2, tag_name: 'js-1.1.24', draft: false, prerelease: false, body: `MIN_NATIVE: 1.1.21\nSHA256: ${SHA}`, assets: [{ id: 20, name: 'locus-bundle.zip', browser_download_url: link('js-1.1.24', 'locus-bundle.zip'), size: 1048576, download_count: 4 }] },
  { id: 1, tag_name: 'v1.1.21', draft: false, prerelease: false, body: `SHA256: ${SHA}`, assets: [{ id: 10, name: 'locus-latest.apk', browser_download_url: link('v1.1.21', 'locus-latest.apk'), size: 5036092 }] },
];

/** A stand-in for gh: answers by subcommand and records every call. */
function fakeGh({ listing = LISTING, exists = true, fail = {} } = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const key = args[0] === 'api' ? 'api' : `${args[0]} ${args[1]}`;
    if (fail[key]) return { status: 1, stdout: '', stderr: fail[key] };
    if (key === 'api') return { status: 0, stdout: JSON.stringify(listing), stderr: '' };
    if (key === 'release view') return exists ? { status: 0, stdout: '{"tagName":"update-index"}', stderr: '' } : { status: 1, stdout: '', stderr: 'release not found' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'locus-update-index-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('rebuilding the file', () => {
  it('lists the releases signed in, writes a file the app trusts, and replaces the published one', () => {
    const gh = fakeGh();
    const result = publishUpdateIndex({ dir, repo: REPO, run: gh.run, now: NOW });
    expect(result.ok).toBe(true);
    expect(gh.calls[0]).toEqual(['api', `repos/${REPO}/releases?per_page=100`]);
    expect(gh.calls[1].slice(0, 3)).toEqual(['release', 'view', 'update-index']);
    expect(gh.calls[2]).toEqual(['release', 'upload', 'update-index', result.file, '--clobber', '--repo', REPO]);
    expect(gh.calls).toHaveLength(3);

    const written = JSON.parse(readFileSync(result.file, 'utf8'));
    expect(result.file.endsWith('update-index.json')).toBe(true);
    expect(written.generatedAt).toBe('2026-10-13T12:00:00.000Z');
    expect(written.releases.map((r) => r.tag_name)).toEqual(['js-1.1.24', 'v1.1.21']);
    expect(parseUpdateIndex(written, { repo: REPO, now: NOW }).ok).toBe(true);
  });

  it('creates the update-index release the first time, as a pre-release that is never "latest"', () => {
    const gh = fakeGh({ exists: false });
    const result = publishUpdateIndex({ dir, repo: REPO, run: gh.run, now: NOW });
    expect(result.ok).toBe(true);
    const create = gh.calls[2];
    expect(create.slice(0, 4)).toEqual(['release', 'create', 'update-index', result.file]);
    expect(create).toContain('--prerelease');
    expect(create).toContain('--latest=false');
    expect(create).toEqual(expect.arrayContaining(['--repo', REPO]));
  });

  it('never uploads a file the app would refuse', () => {
    const gh = fakeGh({ listing: LISTING.filter((r) => !r.tag_name.startsWith('v')) });
    const result = publishUpdateIndex({ dir, repo: REPO, run: gh.run, now: NOW });
    expect(result).toMatchObject({ ok: false, error: 'NO_USABLE_APK' });
    expect(gh.calls.map((c) => c[1])).not.toContain('upload');
    expect(gh.calls.map((c) => c[1])).not.toContain('create');
  });
});

describe('a failure is reported, never thrown', () => {
  it.each([
    ['the releases cannot be listed', { fail: { api: 'HTTP 502' } }, 'list the releases', 'HTTP 502'],
    ['the upload fails', { fail: { 'release upload': 'HTTP 422: Validation Failed' } }, 'upload the file', 'HTTP 422: Validation Failed'],
    ['the release cannot be created', { exists: false, fail: { 'release create': 'HTTP 403' } }, 'create the update-index release', 'HTTP 403'],
  ])('%s', (_, options, step, error) => {
    const result = publishUpdateIndex({ dir, repo: REPO, run: fakeGh(options).run, now: NOW });
    expect(result).toEqual({ ok: false, step, error });
  });

  it('nothing past a failed listing is attempted', () => {
    const gh = fakeGh({ fail: { api: 'offline' } });
    publishUpdateIndex({ dir, repo: REPO, run: gh.run, now: NOW });
    expect(gh.calls).toHaveLength(1);
  });

  it('an unreadable listing, or gh itself blowing up', () => {
    const garbled = publishUpdateIndex({ dir, repo: REPO, run: () => ({ status: 0, stdout: '<html>' }), now: NOW });
    expect(garbled).toMatchObject({ ok: false, step: 'build the file' });
    const thrown = publishUpdateIndex({ dir, repo: REPO, run: () => { throw new Error('spawn gh ENOENT'); }, now: NOW });
    expect(thrown).toEqual({ ok: false, step: 'build the file', error: 'spawn gh ENOENT' });
  });

  it('says loudly that phones will not see the release, and prints the command that fixes it', () => {
    const lines = [];
    reportUpdateIndex({ ok: false, step: 'upload the file', error: 'HTTP 422' }, { log: (s) => lines.push(s) });
    const out = lines.join('\n');
    expect(out).toContain('THE RELEASE ABOVE IS PUBLISHED, BUT THE UPDATE INDEX WAS NOT REBUILT');
    expect(out).toContain('will NOT be offered this release');
    expect(out).toContain('Failed to upload the file: HTTP 422');
    expect(out).toContain(`Fix it with:   ${UPDATE_INDEX_FIX_COMMAND}`);
    expect(UPDATE_INDEX_FIX_COMMAND).toBe('npm run release:index');
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
    expect(pkg.scripts['release:index']).toBe('node scripts/release-index.mjs');
  });

  it('a success says so quietly', () => {
    const lines = [];
    const result = publishUpdateIndex({ dir, repo: REPO, run: fakeGh().run, now: NOW });
    reportUpdateIndex(result, { log: (s) => lines.push(s) });
    expect(lines.join('\n')).toMatch(/Update index rebuilt: 2 releases, newest js-1\.1\.24, v1\.1\.21/);
  });
});

describe('both release scripts rebuild the file as their very last step', () => {
  it.each([['scripts/release.mjs'], ['scripts/release-bundle.mjs']])('%s', (path) => {
    const source = readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');
    const created = source.search(/run\('gh', \[\s*'release',\s*'create',/);
    const rebuilt = source.indexOf("reportUpdateIndex(publishUpdateIndex({ dir: join(STAGING_DIR, 'update-index') }));");
    expect(created).toBeGreaterThan(0);
    // After the release is created, at the top level (not behind a dry run), and nothing after
    // it can fail or exit the script.
    expect(rebuilt).toBeGreaterThan(created);
    expect(source.slice(rebuilt - 1, rebuilt)).toBe('\n');
    const after = source.slice(rebuilt);
    expect(after).not.toMatch(/\bdie\(|process\.exit|\brun\(|throw /);
  });
});
