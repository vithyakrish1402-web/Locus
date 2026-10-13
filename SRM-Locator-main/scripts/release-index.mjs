#!/usr/bin/env node
// Rebuild the update index by hand and upload it (see src/utils/updateIndex.js).
//
//   npm run release:index
//
// Both release scripts do this as their last step. Run it when that step failed, or after a
// release was edited, deleted or made by hand on GitHub: until the index is rebuilt, phones
// read the old one at launch.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishUpdateIndex, reportUpdateIndex, UPDATE_REPO } from './lib/updateIndex.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status !== 0) {
  console.error('\n  release:index: the GitHub CLI is not installed or not authenticated - run `gh auth login`\n');
  process.exit(1);
}

console.log(`\n  Rebuilding the update index of ${UPDATE_REPO}`);
const result = publishUpdateIndex({ dir: join(ROOT, 'dist-release', 'update-index') });
reportUpdateIndex(result, { afterRelease: false });
process.exit(result.ok ? 0 : 1);
