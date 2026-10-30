#!/usr/bin/env node
// Rebuild the update index by hand and upload it (see src/utils/updateIndex.js).
//
//   npm run release:index -- --repo vithyakrish1402-web/Locus-Release
//
// Both release scripts do this as their last step. Run it when that step failed, or after a
// release was edited, deleted or made by hand on GitHub: until the index is rebuilt, phones
// read the old one at launch.
//
// The repo is always named (--repo, or UPDATE_REPO). The file lists that repo's own download
// links, so rebuilding Locus's index for Locus-Release would make every phone still running
// older JS reject it as a foreign link.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishUpdateIndex, reportUpdateIndex } from './lib/updateIndex.mjs';
import { targetRepo } from './lib/repos.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const target = targetRepo(process.argv.slice(2));
if (!target.ok) {
  console.error(`\n  release:index: ${target.error}\n`);
  process.exit(1);
}
const { repo } = target;

if (spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status !== 0) {
  console.error('\n  release:index: the GitHub CLI is not installed or not authenticated - run `gh auth login`\n');
  process.exit(1);
}

console.log(`\n  Rebuilding the update index of ${repo}`);
const result = publishUpdateIndex({ dir: join(ROOT, 'dist-release', 'update-index'), repo });
reportUpdateIndex(result, { afterRelease: false, repo });
process.exit(result.ok ? 0 : 1);
