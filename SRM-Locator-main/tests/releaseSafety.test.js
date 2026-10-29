// Phase 5, the release process: the refusals made before anything is built
// (scripts/lib/releaseChecks.mjs) and the publish order that never leaves half a release and
// tags the commit that was built (scripts/lib/publishRelease.mjs). gh is faked; nothing is
// published.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { minNativeProblem, notesProblem, versionCodeProblem } from '../scripts/lib/releaseChecks.mjs';
import { publishRelease } from '../scripts/lib/publishRelease.mjs';

describe('6. the build number', () => {
  it('is refused unless it is above the published APK', () => {
    expect(versionCodeProblem(11, 10)).toBeNull();
    expect(versionCodeProblem(10, 10, 'v1.1.75')).toMatch(/versionCode 10, but v1\.1\.75 is already 10/);
    // 1.1.36: a branch whose build.gradle had drifted below the published APK.
    expect(versionCodeProblem(7, 10)).toMatch(/Android would refuse it/);
  });

  it('is refused when the published one cannot be read, rather than guessed', () => {
    expect(versionCodeProblem(11, null)).toMatch(/could not read/);
  });
});

describe('7. notes', () => {
  it('may not carry [MANDATORY], which older apps read as the gate, or the lines the app reads', () => {
    expect(notesProblem('- Faster map')).toBeNull();
    expect(notesProblem('We no longer use [MANDATORY] for small fixes')).toMatch(/--mandatory/);
    expect(notesProblem('- fix\nMANDATORY: true')).toMatch(/MANDATORY/);
    expect(notesProblem(`- fix\nSHA256: ${'a'.repeat(64)}`)).toMatch(/SHA256/);
    expect(notesProblem('- fix\nMIN_NATIVE: 1.0.0')).toMatch(/MIN_NATIVE/);
  });

  it('the APK script writes the mandatory line only with --mandatory, and a VERSION_CODE line', () => {
    const script = readFileSync(new URL('../scripts/release.mjs', import.meta.url), 'utf8');
    expect(script).toMatch(/mandatory \? MANDATORY_LINE : null/);
    expect(script).toMatch(/`VERSION_CODE: \$\{nextCode\}`/);
    expect(script).toMatch(/notesProblem\(humanNotes\)/);
  });
});

describe('8. MIN_NATIVE', () => {
  const TAGS = ['js-1.1.83', 'v1.1.75', 'js-1.1.74', 'v1.1.73'];
  it('must be the version of a published APK', () => {
    expect(minNativeProblem('1.1.75', TAGS)).toBeNull();
    expect(minNativeProblem('1.1.73', TAGS)).toBeNull();
    // A branch with an unreleased bump: the bundle would reach no phone.
    expect(minNativeProblem('1.1.84', TAGS)).toMatch(/not a published APK/);
    // A branch with an old build.gradle: a bundle version is not an APK.
    expect(minNativeProblem('1.1.74', TAGS)).toMatch(/not a published APK/);
    expect(minNativeProblem('1.1', TAGS)).toMatch(/three-part/);
  });

  it('the bundle script checks it against the published tags', () => {
    const script = readFileSync(new URL('../scripts/release-bundle.mjs', import.meta.url), 'utf8');
    expect(script).toMatch(/minNativeProblem\(minNative, tags\)/);
  });
});

/** A fake gh: answers by command, records every call. */
function fakeGh({ existing = null, fail = null, taggedAt = 'BUILT' } = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(' ');
    if (fail === key) return { status: 1, stderr: `${key} failed` };
    if (key === 'release view') return existing ? { status: 0, stdout: JSON.stringify({ isDraft: existing === 'draft' }) } : { status: 1, stderr: 'not found' };
    if (args[0] === 'api') return { status: 0, stdout: `${taggedAt}\n` };
    return { status: 0, stdout: '' };
  };
  return { run, calls };
}
const RELEASE = { tag: 'js-9.9.9', title: 'LOCUS JS bundle 9.9.9', asset: 'bundle.zip', notesFile: 'notes.md', target: 'BUILT' };

describe('9. the tag', () => {
  it('is made at the built commit (--target), and checked afterwards', () => {
    const gh = fakeGh();
    expect(publishRelease({ ...RELEASE, run: gh.run })).toEqual({ ok: true });
    const create = gh.calls.find((a) => a[0] === 'release' && a[1] === 'create');
    expect(create).toEqual(expect.arrayContaining(['--target', 'BUILT']));
    expect(gh.calls.at(-1)[1]).toBe('repos/{owner}/{repo}/git/ref/tags/js-9.9.9');
  });

  it('pointing anywhere else is reported', () => {
    const gh = fakeGh({ taggedAt: 'MAIN' });
    const result = publishRelease({ ...RELEASE, run: gh.run });
    expect(result).toMatchObject({ ok: false, step: 'check the tag' });
    expect(result.error).toMatch(/points at MAIN, not the built commit BUILT/);
  });

  it('both scripts publish through it, pushing the built commit first', () => {
    for (const name of ['release.mjs', 'release-bundle.mjs']) {
      const script = readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
      expect(script).toMatch(/publishRelease\(\{/);
      expect(script).not.toMatch(/'release',\s*'create'/);
      expect(script.indexOf("'push', 'origin', 'HEAD'")).toBeGreaterThan(0);
      expect(script.indexOf("'push', 'origin', 'HEAD'")).toBeLessThan(script.indexOf('publishRelease({'));
    }
  });
});

describe('10. a failure part way', () => {
  it('is a draft until everything is uploaded: the release is public only at the last step', () => {
    const gh = fakeGh();
    publishRelease({ ...RELEASE, run: gh.run });
    const steps = gh.calls.map((a) => a.slice(0, 2).join(' '));
    expect(steps).toEqual(['release view', 'release create', 'release edit', 'api repos/{owner}/{repo}/git/ref/tags/js-9.9.9']);
    expect(gh.calls[1]).toContain('--draft');
    expect(gh.calls[2]).toEqual(['release', 'edit', 'js-9.9.9', '--draft=false']);
  });

  it('a failed upload stops before publishing, and says the same command can be run again', () => {
    const gh = fakeGh({ fail: 'release create' });
    const result = publishRelease({ ...RELEASE, run: gh.run });
    expect(result).toMatchObject({ ok: false, step: 'upload the release as a draft' });
    expect(result.retry).toMatch(/Nothing is public. Run the same release command again/);
    expect(gh.calls.some((a) => a[1] === 'edit')).toBe(false);
  });

  it('a rerun replaces the draft a failed run left', () => {
    const gh = fakeGh({ existing: 'draft' });
    expect(publishRelease({ ...RELEASE, run: gh.run })).toEqual({ ok: true });
    expect(gh.calls[1]).toEqual(['release', 'delete', 'js-9.9.9', '--yes']);
  });

  it('never touches a release already published', () => {
    const gh = fakeGh({ existing: 'published' });
    expect(publishRelease({ ...RELEASE, run: gh.run })).toMatchObject({ ok: false, error: 'js-9.9.9 is already published' });
    expect(gh.calls).toHaveLength(1);
  });

  it('the APK script resumes from its own release commit after a failed push, without bumping again', () => {
    const script = readFileSync(new URL('../scripts/release.mjs', import.meta.url), 'utf8');
    expect(script).toMatch(/const resuming =/);
    expect(script).toMatch(/isBaseline \|\| resuming \? currentCode : currentCode \+ 1/);
    expect(script).toMatch(/the push failed, so nothing was published/);
  });
});
