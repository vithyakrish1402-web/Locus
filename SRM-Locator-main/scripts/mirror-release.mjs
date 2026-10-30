#!/usr/bin/env node
// Copy one existing release from one repo to another, byte for byte. Builds nothing.
//
//   node scripts/mirror-release.mjs --from vithyakrish1402-web/Locus --to vithyakrish1402-web/Locus-Release --tag js-1.1.84 --dry-run
//
// See scripts/lib/mirrorRelease.mjs for exactly what is and is not copied. It does not rebuild
// the update index: run `npm run release:index -- --repo <the target>` afterwards.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagValue } from './lib/repos.mjs';
import { mirrorRelease } from './lib/mirrorRelease.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const die = (message) => {
  console.error(`\n  mirror-release: ${message}\n`);
  process.exit(1);
};

if (spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status !== 0) {
  die('the GitHub CLI is not installed or not authenticated - run `gh auth login`');
}

const from = flagValue(argv, '--from');
const to = flagValue(argv, '--to');
const tag = flagValue(argv, '--tag');
const dryRun = argv.includes('--dry-run');

const result = mirrorRelease({
  from,
  to,
  tag,
  dryRun,
  run: (args) => spawnSync('gh', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }),
  workDir: join(ROOT, 'dist-release', 'mirror', String(tag).replace(/[^A-Za-z0-9._-]/g, '_')),
});
if (!result.ok) die(result.error);

const r = result.report;
console.log(`
  ${result.dryRun ? '--- dry run (nothing is published) ---' : '--- mirrored ---'}
  from            ${r.from}
  to              ${r.to}
  tag             ${r.tag}   (title: ${r.title})
  asset           ${r.asset}  (${r.bytes} bytes)
  SHA-256         ${r.sha256}   (matches the release body)
  MIN_NATIVE      ${r.minNative ?? 'none'}
  VERSION_CODE    ${r.versionCode ?? 'none'}
  [MANDATORY]     ${r.mandatory ? 'YES' : 'no'}
  version check   ${r.safeguard}
  ---------------------------------------
`);
if (!result.dryRun) console.log(`  Next: npm run release:index -- --repo ${r.to}\n`);
