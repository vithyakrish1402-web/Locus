// Publish a release so that a failure part way never leaves a half-done one, and its tag is the
// commit that was built. Used by both release scripts.
//
// 1. A draft left by an earlier failed run of the same release is deleted (a draft is never
//    public, has no tag yet, and no phone reads it).
// 2. The release is created as a DRAFT, its file uploaded, with --target the built commit.
//    `gh release create` without --target tagged whatever was newest on GitHub's default branch,
//    which is why js-* tags pointed at main rather than at what was built.
// 3. Only then is the draft published, which creates the tag. Phones see the release complete
//    or not at all.
// 4. The tag is read back and compared with the built commit.
//
// Every step can simply be run again: rerunning the release command after a failure starts
// from step 1.

import { spawnSync } from 'node:child_process';

// gh is a real executable, so no shell (see the release scripts on Windows shells).
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8' });

/**
 * @param {{tag: string, title: string, asset: string, notesFile: string, target: string,
 *   run?: (args: string[]) => {status: number, stdout?: string, stderr?: string}}} options
 *   target: the full sha of the built commit, already pushed; run: runs gh (tests pass a fake)
 * @returns {{ok: true} | {ok: false, step: string, error: string, retry: string}}
 */
export function publishRelease({ tag, title, asset, notesFile, target, run = gh }) {
  const failed = (step, result, retry) => ({
    ok: false,
    step,
    error: (result?.stderr || result?.error?.message || `exit code ${result?.status}`).toString().trim(),
    retry,
  });
  const rerun = 'Nothing is public. Run the same release command again: it starts over from here.';

  const existing = run(['release', 'view', tag, '--json', 'isDraft']);
  if (existing.status === 0) {
    let isDraft = false;
    try {
      isDraft = JSON.parse(existing.stdout || '{}').isDraft === true;
    } catch { /* unreadable: treated as published, the safe way */ }
    if (!isDraft) return { ok: false, step: 'check the tag is free', error: `${tag} is already published`, retry: 'Pick the next version.' };
    const removed = run(['release', 'delete', tag, '--yes']);
    if (removed.status !== 0) return failed(`delete the draft ${tag} left by an earlier run`, removed, `Delete the draft ${tag} on GitHub, then run the release command again.`);
  }

  const created = run(['release', 'create', tag, asset, '--draft', '--target', target, '--title', title, '--notes-file', notesFile]);
  if (created.status !== 0) return failed('upload the release as a draft', created, rerun);

  const published = run(['release', 'edit', tag, '--draft=false']);
  if (published.status !== 0) {
    return failed('publish the draft', published, `The draft ${tag} is uploaded but not public. Run the same release command again, or publish the draft on GitHub.`);
  }

  // GitHub made the tag on publishing; it must be the commit that was built.
  const ref = run(['api', `repos/{owner}/{repo}/git/ref/tags/${tag}`, '--jq', '.object.sha']);
  const tagged = (ref.stdout || '').trim();
  if (ref.status !== 0 || tagged !== target) {
    return {
      ok: false,
      step: 'check the tag',
      error: ref.status !== 0 ? (ref.stderr || 'could not read the tag').toString().trim() : `${tag} points at ${tagged}, not the built commit ${target}`,
      retry: 'The release is public. Check the tag on GitHub before the next release.',
    };
  }
  return { ok: true };
}
