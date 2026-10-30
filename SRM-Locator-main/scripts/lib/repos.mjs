// Which GitHub repo the release scripts publish to, and the tags already published in the repos
// phones have read from. Used by both release scripts, release:index, release:verify and
// mirror-release.
//
// Two repos exist during the move: phones running older JS read OLD_REPO, phones running the
// redirect bundle read NEW_REPO. Nothing here ever falls back to `origin`: publishing needs a
// target said out loud (--repo or UPDATE_REPO), so a release can't land in the wrong repo.

import { spawnSync } from 'node:child_process';
import { compareVersions } from '../../src/utils/updateManifest.js';

export const OLD_REPO = 'vithyakrish1402-web/Locus';
export const NEW_REPO = 'vithyakrish1402-web/Locus-Release';

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** The flag's value, from `--name value` or `--name=value`; null when absent. */
export function flagValue(argv, name) {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i === -1) return null;
  return argv[i].includes('=') ? argv[i].slice(name.length + 1) : (argv[i + 1] ?? '');
}

/**
 * The repo a command publishes to: `--repo <owner/name>`, else UPDATE_REPO. Never `origin`.
 * @returns {{ok: true, repo: string} | {ok: false, error: string}}
 */
export function targetRepo(argv = [], env = process.env) {
  const chosen = flagValue(argv, '--repo') ?? env.UPDATE_REPO ?? '';
  if (!chosen) {
    return {
      ok: false,
      error: `no target repo. Say where to publish with --repo <owner/name> (or UPDATE_REPO), for example --repo ${NEW_REPO} or --repo ${OLD_REPO}`,
    };
  }
  if (!REPO_SHAPE.test(chosen)) return { ok: false, error: `"${chosen}" is not an owner/name repo` };
  return { ok: true, repo: chosen };
}

const sameRepo = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** The repo `origin` points at (where the source is pushed), or null. */
export function originRepo({ cwd } = {}) {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\s*$/.exec(result.stdout || '');
  return match ? match[1] : null;
}

/**
 * Should a release in `repo` be tagged at the commit that was built? Only when `repo` is the
 * repo the source is pushed to. A releases-only repo doesn't hold that commit, so its tags
 * can't point at it.
 */
export const tagsBuiltCommit = (repo, origin) => origin !== null && sameRepo(repo, origin);

const LIST_LIMIT = 1000;

/**
 * Every published (non-draft) release tag in each repo, asked of GitHub. An empty repo is a
 * valid answer. Any failure to ask (network, not found, no permission, an answer that isn't a
 * list, a list as long as the limit) fails closed: nothing is returned that could be mistaken
 * for "nothing published".
 *
 * @param {(args: string[]) => {status: number, stdout?: string, stderr?: string}} run runs gh
 * @returns {{ok: true, tags: string[], byRepo: Record<string, string[]>} | {ok: false, error: string}}
 */
export function publishedTagsOfRepos(run, repos = [OLD_REPO, NEW_REPO]) {
  const byRepo = {};
  for (const repo of repos) {
    let result;
    try {
      result = run(['release', 'list', '--repo', repo, '--limit', String(LIST_LIMIT), '--json', 'tagName,isDraft']);
    } catch (e) {
      return { ok: false, error: `could not list the releases of ${repo}: ${e?.message || e}` };
    }
    if (result?.status !== 0) {
      const why = (result?.stderr || `exit code ${result?.status}`).toString().trim();
      return { ok: false, error: `could not list the releases of ${repo} (${why}). Nothing was published: the version check needs both repos` };
    }
    let list;
    try {
      list = JSON.parse(result.stdout || '');
    } catch {
      return { ok: false, error: `the release list of ${repo} was not readable. Nothing was published` };
    }
    if (!Array.isArray(list) || list.length >= LIST_LIMIT) {
      return { ok: false, error: `the release list of ${repo} may be incomplete. Nothing was published` };
    }
    byRepo[repo] = list.filter((r) => r && !r.isDraft && typeof r.tagName === 'string').map((r) => r.tagName);
  }
  return { ok: true, tags: Object.values(byRepo).flat(), byRepo };
}

const seriesOf = (tag) => (/^js-/.test(tag) ? 'js' : /^v\d/i.test(tag) ? 'v' : null);
const versionOf = (tag) => String(tag).replace(/^js-/, '').replace(/^v/i, '');

/**
 * Copying an existing release must never publish a version below one already out in its own
 * series, in either repo. The same version as the highest is fine: it is the one being copied.
 * Returns a sentence saying what is wrong, or null.
 */
export function mirrorVersionProblem(tag, publishedTags) {
  const series = seriesOf(tag);
  if (!series || compareVersions(versionOf(tag), '0.0.0') === null) return `"${tag}" is not a v* or js-* release tag`;
  const higher = publishedTags.find(
    (other) => seriesOf(other) === series && compareVersions(versionOf(other), versionOf(tag)) === 1
  );
  return higher ? `${tag} is below ${higher}, which is already published. A lower version must never be published` : null;
}
