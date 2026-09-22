#!/usr/bin/env node
// Publish a JS-only live update (Phase 2). No APK, no reinstall.
//
//   npm run release:bundle -- 1.0.1
//   npm run release:bundle -- 1.0.1 --min-native 1.1.0 --dry-run
//
// Builds dist/, zips it, and publishes it as a `js-<version>` GitHub release whose body
// carries the two lines the client parses (see src/utils/liveUpdateManifest.js):
//
//   SHA256: <digest>       verified natively before the bundle is ever activated
//   MIN_NATIVE: <version>  the oldest native shell allowed to run this bundle
//
// MIN_NATIVE defaults to the versionName currently in build.gradle, which is the right
// answer whenever the bundle was built against the shell you have. Raise it by hand only
// if you know the bundle needs something older shells lack — and if it needs a native
// change at all, this is the wrong script: cut a Phase 1 APK release instead.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDirectory } from './lib/zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRADLE_FILE = join(ROOT, 'android', 'app', 'build.gradle');
const DIST_DIR = join(ROOT, 'dist');
const STAGING_DIR = join(ROOT, 'dist-release');
const BUNDLE_ASSET_NAME = 'locus-bundle.zip';
const IS_WINDOWS = process.platform === 'win32';

// Windows can only spawn .cmd/.bat shims (npm, npx, gradlew.bat) through a shell, but a
// shell also re-splits arguments on spaces - which silently broke `git log
// --pretty=format:- %s` and would have mangled multi-word commit messages. So: shell for
// the shims that need it, direct spawn for real executables like git and gh.
const needsShell = (command) =>
  IS_WINDOWS && (/^(npm|npx|yarn|pnpm)$/.test(command) || /\.(cmd|bat)$/i.test(command));

const die = (message) => {
  console.error(`\n  release:bundle: ${message}\n`);
  process.exit(1);
};

const run = (command, args, options = {}) => {
  console.log(`\n  $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: needsShell(command), ...options });
  if (result.status !== 0) die(`\`${command}\` exited with code ${result.status}`);
  return result;
};

const capture = (command, args) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: needsShell(command) });
  return { status: result.status, stdout: (result.stdout || '').trim() };
};

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const minNativeArg = flagValue('--min-native');
const notesFile = flagValue('--notes');
const dryRun = argv.includes('--dry-run');
const version = argv.find((a) => !a.startsWith('--') && a !== minNativeArg && a !== notesFile);

if (!version) {
  die('usage: npm run release:bundle -- <version> [--min-native <version>] [--notes <file>] [--dry-run]');
}
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`"${version}" is not a three-part semver (e.g. 1.0.1)`);

// ---------------------------------------------------------------- preflight

if (capture('gh', ['auth', 'status']).status !== 0) {
  die('the GitHub CLI is not installed or not authenticated - run `gh auth login`');
}

const gradle = readFileSync(GRADLE_FILE, 'utf8');
const nativeName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
if (!nativeName) die('could not read versionName from android/app/build.gradle');

const minNative = minNativeArg || nativeName;
if (!/^\d+\.\d+\.\d+$/.test(minNative)) die(`--min-native "${minNative}" is not a three-part semver`);

const asTuple = (v) => v.split('.').map(Number);
const [minMaj, minMin, minPatch] = asTuple(minNative);
const [natMaj, natMin, natPatch] = asTuple(nativeName);
if (minMaj > natMaj || (minMaj === natMaj && (minMin > natMin || (minMin === natMin && minPatch > natPatch)))) {
  // Publishing this would gate the bundle off every device in existence, including
  // whatever you are about to test on.
  die(`--min-native ${minNative} is newer than the current native versionName ${nativeName} - ship a Phase 1 APK release first`);
}

if (capture('git', ['tag', '--list', `js-${version}`]).stdout) die(`tag js-${version} already exists`);

console.log(`\n  LOCUS JS bundle js-${version}`);
console.log(`  Requires native shell >= ${minNative} (current native versionName: ${nativeName})`);
if (dryRun) console.log('  DRY RUN: builds and hashes, but publishes nothing.');

// ---------------------------------------------------------------- build + zip

run('npm', ['run', 'build']);
if (!existsSync(DIST_DIR)) die('npm run build produced no dist/');

rmSync(STAGING_DIR, { recursive: true, force: true });
mkdirSync(STAGING_DIR, { recursive: true });
const zipPath = join(STAGING_DIR, BUNDLE_ASSET_NAME);

// Written in-process rather than shelling out to Compress-Archive/zip: the plugin needs
// index.html at the ZIP ROOT with forward-slash entry names, and PowerShell produces
// backslashes that Android's unzip reads as flat filenames. See scripts/lib/zip.mjs.
//
// Every entry gets the same fixed timestamp so the archive is byte-reproducible: the
// same dist/ always hashes to the same SHA256, whether it is a dry run, the real publish
// or a rebuild on another machine. Nothing on device reads it - the plugin extracts
// files with their own mtimes. Built with the LOCAL-time constructor because zip.mjs
// reads it back with local getters (DOS time has no zone), which makes the stored fields
// 1980-02-01 00:00 in every timezone. Feb, not Jan 1, so that no zone conversion can
// push it before the 1980 DOS epoch - the same constant Gradle uses for reproducible zips.
const ZIP_MTIME = new Date(1980, 1, 1);
console.log(`\n  Zipping dist/ -> ${BUNDLE_ASSET_NAME}`);
const bytes = zipDirectory(DIST_DIR, ZIP_MTIME);
writeFileSync(zipPath, bytes);

const sha256 = createHash('sha256').update(bytes).digest('hex');
console.log(`\n  ${BUNDLE_ASSET_NAME}  ${(bytes.length / 1024).toFixed(0)} KB\n  SHA256: ${sha256}`);

// ---------------------------------------------------------------- release body

const humanNotes = notesFile
  ? readFileSync(resolve(ROOT, notesFile), 'utf8').trim()
  : capture('git', ['log', '--pretty=format:- %s', '-10']).stdout;

const body = [humanNotes, '', `MIN_NATIVE: ${minNative}`, `SHA256: ${sha256}`].join('\n');
const bodyFile = join(STAGING_DIR, 'BUNDLE_NOTES.md');
writeFileSync(bodyFile, body);
console.log(`\n  --- release body ---\n${body}\n  --------------------`);

if (dryRun) {
  console.log(`\n  Dry run complete. Staged at ${STAGING_DIR}.\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- publish

run('gh', [
  'release',
  'create',
  `js-${version}`,
  zipPath,
  '--title',
  `LOCUS JS bundle ${version}`,
  '--notes-file',
  bodyFile,
]);

console.log(`\n  Published js-${version}. Devices on native >= ${minNative} pick it up on their next cold start.\n`);
