// Rebuild the update index (src/utils/updateIndex.js) from the real releases and upload it to
// the `update-index` release. The last step of both release scripts, and the whole of
// `npm run release:index`.
//
// The releases are listed with `gh api`, which is signed in and so never spends the anonymous
// limit phones share. The file is checked with the app's own parseUpdateIndex before it is
// uploaded, so a file the app would refuse is never published.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UPDATE_INDEX_ASSET_NAME,
  UPDATE_INDEX_TAG,
  buildUpdateIndex,
  parseUpdateIndex,
} from '../../src/utils/updateIndex.js';

/** The repo the app reads releases from (src/utils/releasesLookup.js), as release:verify reads it. */
export const UPDATE_REPO = process.env.VITE_UPDATE_REPO || 'vithyakrish1402-web/Locus';

/** What to run when the rebuild failed. */
export const UPDATE_INDEX_FIX_COMMAND = 'npm run release:index';

/** The fix command for a given repo: the release scripts can publish elsewhere with --repo. */
export const updateIndexFixCommand = (repo = UPDATE_REPO) =>
  repo === UPDATE_REPO ? UPDATE_INDEX_FIX_COMMAND : `${UPDATE_INDEX_FIX_COMMAND} -- --repo ${repo}`;

// gh is a real executable, so no shell (see the release scripts on Windows shells).
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const failed = (step, result) => ({
  ok: false,
  step,
  error: (result?.stderr || result?.error?.message || `exit code ${result?.status}`).toString().trim(),
});

/**
 * Rebuild and upload the file. Never throws: a failure comes back as {ok: false, step, error}.
 *
 * @param {{dir: string, repo?: string, run?: (args: string[]) => {status: number, stdout?: string, stderr?: string}, now?: number}} options
 *   dir: where to write the file before uploading it; run: runs gh (tests pass a fake)
 * @returns {{ok: true, file: string, index: object} | {ok: false, step: string, error: string}}
 */
export function publishUpdateIndex({ dir, repo = UPDATE_REPO, run = gh, now = Date.now() }) {
  try {
    // 100 is enough to find the newest 30 v* and js-* releases past anything else.
    const listed = run(['api', `repos/${repo}/releases?per_page=100`]);
    if (listed.status !== 0) return failed('list the releases', listed);

    const index = buildUpdateIndex(JSON.parse(listed.stdout), { now });
    const check = parseUpdateIndex(index, { repo, now });
    if (!check.ok) return { ok: false, step: 'check the new file the way the app does', error: check.reason };

    mkdirSync(dir, { recursive: true });
    const file = join(dir, UPDATE_INDEX_ASSET_NAME);
    writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`);

    // Replacing the file deletes the old one first; a phone asking in that moment uses the
    // API listing instead.
    const exists = run(['release', 'view', UPDATE_INDEX_TAG, '--repo', repo, '--json', 'tagName']);
    const uploaded =
      exists.status === 0
        ? run(['release', 'upload', UPDATE_INDEX_TAG, file, '--clobber', '--repo', repo])
        : run([
            'release',
            'create',
            UPDATE_INDEX_TAG,
            file,
            '--repo',
            repo,
            // Never GitHub's "latest" release, and never mistaken for a LOCUS release: the
            // update checks only read v* and js-* tags.
            '--prerelease',
            '--latest=false',
            '--title',
            'LOCUS update index (not an app release)',
            '--notes',
            'The list of current LOCUS releases that the app reads at launch, rebuilt by the release scripts. ' +
              'Not an app release: do not delete it, rename it or untick pre-release. See UPDATER.md.',
          ]);
    if (uploaded.status !== 0) return failed(exists.status === 0 ? 'upload the file' : 'create the update-index release', uploaded);
    return { ok: true, file, index };
  } catch (error) {
    return { ok: false, step: 'build the file', error: error?.message || String(error) };
  }
}

/** Print the outcome. A failure is loud, says what it means for phones and how to fix it. */
export function reportUpdateIndex(result, { afterRelease = true, log = console.log, repo = UPDATE_REPO } = {}) {
  if (result.ok) {
    const tags = result.index.releases.map((release) => release.tag_name);
    log(`\n  Update index rebuilt: ${tags.length} releases, newest ${tags.slice(0, 3).join(', ')}.\n`);
    return;
  }
  const bar = `  ${'!'.repeat(72)}`;
  log(
    [
      '',
      bar,
      afterRelease
        ? '  !!  THE RELEASE ABOVE IS PUBLISHED, BUT THE UPDATE INDEX WAS NOT REBUILT.'
        : '  !!  THE UPDATE INDEX WAS NOT REBUILT.',
      afterRelease
        ? '  !!  Phones read the old index at launch and will NOT be offered this release until it is.'
        : '  !!  Phones keep reading the old index at launch.',
      `  !!  Failed to ${result.step}: ${result.error}`,
      '  !!',
      `  !!  Fix it with:   ${updateIndexFixCommand(repo)}`,
      bar,
      '',
    ].join('\n')
  );
}
