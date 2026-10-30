// Copy one existing release from one repo to another, byte for byte, without rebuilding anything.
// The logic behind scripts/mirror-release.mjs; `run` runs gh (tests pass a fake).
//
// Only the release's real asset is copied (locus-latest.apk for v*, locus-bundle.zip for js-*).
// Nothing else on the release (verification.json, update-index snapshots, GitHub's source
// archives) is ever downloaded or uploaded. The downloaded bytes must hash to the SHA256: line
// of the source release body, and the target release gets the same tag, title and body, so the
// SHA256: / MIN_NATIVE: / VERSION_CODE: / [MANDATORY] lines are identical.
//
// The update index is not touched: it is rebuilt in its own step, for the repo it belongs to.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OLD_REPO, NEW_REPO, mirrorVersionProblem, publishedTagsOfRepos } from './repos.mjs';
import { publishRelease } from './publishRelease.mjs';

export const assetNameForTag = (tag) => (/^js-\d/.test(tag) ? 'locus-bundle.zip' : /^v\d/i.test(tag) ? 'locus-latest.apk' : null);

const bodyLine = (body, name) => new RegExp(`^[ \\t]*${name}[ \\t]*:[ \\t]*(\\S+)`, 'im').exec(body)?.[1] ?? null;

/**
 * @returns {{ok: true, report: object, dryRun: boolean} | {ok: false, error: string}}
 */
export function mirrorRelease({ from, to, tag, dryRun = false, run, workDir }) {
  const fail = (error) => ({ ok: false, error });
  const asset = assetNameForTag(tag);
  if (!from || !to || !tag) return fail('usage: --from <owner/name> --to <owner/name> --tag <tag>');
  if (!asset) return fail(`"${tag}" is not a v<version> or js-<version> tag`);
  if (from.toLowerCase() === to.toLowerCase()) return fail('--from and --to are the same repo');

  // Both known repos plus the two named, so the version check always sees everything.
  const repos = [...new Set([OLD_REPO, NEW_REPO, from, to])];
  const published = publishedTagsOfRepos(run, repos);
  if (!published.ok) return fail(published.error);
  if (!published.byRepo[from].includes(tag)) return fail(`${tag} is not a published release of ${from}`);
  if (published.byRepo[to].includes(tag)) return fail(`${tag} already exists in ${to}. A mirror never overwrites a release`);
  const versionRefused = mirrorVersionProblem(tag, published.tags);
  if (versionRefused) return fail(versionRefused);

  const viewed = run(['release', 'view', tag, '--repo', from, '--json', 'name,body,isDraft,isPrerelease,assets']);
  if (viewed.status !== 0) return fail(`could not read ${tag} in ${from}: ${(viewed.stderr || '').toString().trim()}`);
  let source;
  try {
    source = JSON.parse(viewed.stdout || '');
  } catch {
    return fail(`the release ${tag} in ${from} was not readable`);
  }
  if (source.isDraft || source.isPrerelease) return fail(`${tag} is a draft or pre-release, not a real release`);
  const wanted = (source.assets || []).find((a) => a.name === asset);
  if (!wanted) return fail(`${tag} in ${from} has no ${asset}`);
  const body = typeof source.body === 'string' ? source.body : '';
  const expectedSha = (bodyLine(body, 'SHA-?256') || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedSha)) return fail(`${tag} has no valid SHA256: line in its body, so the copy can't be checked`);

  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const downloaded = run(['release', 'download', tag, '--repo', from, '--pattern', asset, '--dir', workDir]);
  if (downloaded.status !== 0) return fail(`could not download ${asset} of ${tag}: ${(downloaded.stderr || '').toString().trim()}`);
  const files = readdirSync(workDir);
  if (files.length !== 1 || files[0] !== asset) return fail(`expected exactly ${asset} in the download, got: ${files.join(', ') || 'nothing'}`);
  const assetPath = join(workDir, asset);
  const bytes = readFileSync(assetPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expectedSha) {
    return fail(`the downloaded ${asset} hashes to ${sha256}, but the release body says ${expectedSha}. Nothing was published`);
  }
  if (Number.isFinite(wanted.size) && wanted.size !== bytes.length) {
    return fail(`the downloaded ${asset} is ${bytes.length} bytes, but the release lists ${wanted.size}. Nothing was published`);
  }

  const report = {
    from,
    to,
    tag,
    title: source.name,
    asset,
    bytes: bytes.length,
    sha256,
    minNative: bodyLine(body, 'MIN_NATIVE'),
    versionCode: bodyLine(body, 'VERSION_CODE'),
    mandatory: /\[MANDATORY\]/.test(body) || /^[ \t]*MANDATORY[ \t]*:/im.test(body),
    safeguard: `PASSED: ${tag} is not below any published release of its series in ${repos.join(' / ')}`,
  };
  if (dryRun) return { ok: true, dryRun: true, report };

  const notesFile = join(workDir, 'RELEASE_BODY.md');
  writeFileSync(notesFile, body);
  const result = publishRelease({ tag, title: source.name, asset: assetPath, notesFile, target: null, repo: to, run });
  if (!result.ok) return fail(`could not ${result.step}: ${result.error}. ${result.retry}`);

  const copied = run(['release', 'view', tag, '--repo', to, '--json', 'body']);
  let copiedBody = null;
  try {
    copiedBody = JSON.parse(copied.stdout || '').body;
  } catch { /* reported below */ }
  if (copiedBody === null || copiedBody.trim() !== body.trim()) {
    return fail(`${tag} was published to ${to}, but its body does not read back the same. Check it before going on`);
  }
  return { ok: true, dryRun: false, report };
}
