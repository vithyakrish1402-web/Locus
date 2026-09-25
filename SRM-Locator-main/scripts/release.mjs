#!/usr/bin/env node
// Cut a LOCUS release that the in-app updater can consume.
//
//   npm run release -- 1.1.0
//   npm run release -- 1.1.0 --mandatory --notes notes.md
//   npm run release -- 1.1.0 --dry-run
//
// The GitHub release IS the update manifest (see src/utils/updateManifest.js), so this
// script is the only place the three things the client relies on are produced together:
// the tag, an asset named locus-latest.apk, and a "SHA256: <digest>" line in the body.
// Writing them by hand is how a checksum silently stops matching its binary.
//
// Requires: the `gh` CLI, authenticated (`gh auth login`), and release signing
// configured in android/local.properties (see UPDATER.md).

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseVersionConflict } from '../src/utils/liveUpdateManifest.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRADLE_FILE = join(ROOT, 'android', 'app', 'build.gradle');
const APK_ASSET_NAME = 'locus-latest.apk';
const STAGING_DIR = join(ROOT, 'dist-release');
const IS_WINDOWS = process.platform === 'win32';

// Windows can only spawn .cmd/.bat shims (npm, npx, gradlew.bat) through a shell, but a
// shell also re-splits arguments on spaces - which silently broke `git log
// --pretty=format:- %s` and would have mangled multi-word commit messages. So: shell for
// the shims that need it, direct spawn for real executables like git and gh.
const needsShell = (command) =>
  IS_WINDOWS && (/^(npm|npx|yarn|pnpm)$/.test(command) || /\.(cmd|bat)$/i.test(command));

const die = (message) => {
  console.error(`\n  release: ${message}\n`);
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
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
};

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const notesIndex = argv.indexOf('--notes');
const notesFile = notesIndex !== -1 ? argv[notesIndex + 1] : null;
const version = positional.find((a) => !a.startsWith('-') && a !== notesFile);
const mandatory = flags.has('--mandatory');
const dryRun = flags.has('--dry-run');

if (!version) die('usage: npm run release -- <version> [--mandatory] [--notes <file>] [--dry-run]');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  // The client parses the tag with a semver regex and fails closed on anything else,
  // so a malformed tag here means a release nobody is ever offered.
  die(`"${version}" is not a three-part semver (e.g. 1.2.0)`);
}

// ---------------------------------------------------------------- preflight

const gh = capture('gh', ['auth', 'status']);
if (gh.status !== 0) die('the GitHub CLI is not installed or not authenticated - run `gh auth login`');

const dirty = capture('git', ['status', '--porcelain']);
if (dirty.stdout && !dryRun) {
  die('working tree is not clean - commit or stash first (the version bump is committed as part of the release)');
}

const gradle = readFileSync(GRADLE_FILE, 'utf8');
const currentCodeMatch = /versionCode\s+(\d+)/.exec(gradle);
const currentNameMatch = /versionName\s+"([^"]+)"/.exec(gradle);
if (!currentCodeMatch || !currentNameMatch) die('could not read versionCode/versionName from android/app/build.gradle');

const currentCode = Number(currentCodeMatch[1]);
const currentName = currentNameMatch[1];

// Tolerates the pre-updater "1.0" style as well as proper semver; missing parts are 0.
const asTuple = (v) => {
  const parts = v.replace(/^v/i, '').split('.').map((p) => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};
const [cMaj, cMin, cPatch] = asTuple(currentName);
const [nMaj, nMin, nPatch] = asTuple(version);
const isNewer = nMaj > cMaj || (nMaj === cMaj && (nMin > cMin || (nMin === cMin && nPatch > cPatch)));
const isSameAsCurrent = nMaj === cMaj && nMin === cMin && nPatch === cPatch;

// The very first release is a special case. build.gradle ships at 1.0.0, so requiring
// "strictly newer" would make the baseline release impossible to cut without
// hand-editing the file this script tells you not to hand-edit. When no v* tag exists
// yet there is nothing installed for a client to compare against, so publishing the
// current versionName as-is is correct - and the strict check resumes once that first
// tag exists, because from then on there ARE installs in the field.
const isFirstRelease = capture('git', ['tag', '--list', 'v*']).stdout === '';
const isBaseline = isFirstRelease && isSameAsCurrent;

if (!isNewer && !isBaseline) {
  die(
    isSameAsCurrent
      ? `${version} matches the current versionName and v-tags already exist - pick a newer version`
      : `${version} is not newer than the current versionName ${currentName}`
  );
}

// Don't bump the code for a baseline that reuses the current versionName: publish
// exactly what build.gradle already describes.
const nextCode = isBaseline ? currentCode : currentCode + 1;

const existingTag = capture('git', ['tag', '--list', `v${version}`]);
if (existingTag.stdout) die(`tag v${version} already exists`);

// Every release tag on GitHub, in both series. Releases are made with `gh release create`,
// which tags on GitHub only, so the local clone's tags can't be trusted to be complete.
const publishedTags = () => {
  const listed = capture('gh', ['release', 'list', '--limit', '500', '--json', 'tagName', '--jq', '.[].tagName']);
  if (listed.status !== 0) die('could not list the published releases (gh release list)');
  return listed.stdout.split(/\r?\n/).filter(Boolean);
};
// Above every JS bundle too: see releaseVersionConflict.
const versionConflict = releaseVersionConflict(version, publishedTags());
if (versionConflict) die(versionConflict);

if (isBaseline) {
  console.log(`\n  LOCUS BASELINE release ${version} (code ${currentCode}) - first release, nothing bumped`);
  console.log('  Everyone must uninstall any existing LOCUS and install this one by hand.');
} else {
  console.log(`\n  LOCUS release ${currentName} (code ${currentCode})  ->  ${version} (code ${nextCode})`);
}
if (mandatory) console.log('  Marked [MANDATORY]: clients will be locked until they install it.');
if (dryRun) console.log('  DRY RUN: builds and hashes, but publishes nothing.');

// ---------------------------------------------------------------- version bump

const bumped = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
const gradleChanged = bumped !== gradle;
if (gradleChanged) {
  writeFileSync(GRADLE_FILE, bumped);
  console.log(`\n  Bumped android/app/build.gradle`);
} else {
  console.log(`\n  android/app/build.gradle already at ${version} (code ${nextCode}) - nothing to bump`);
}

// ---------------------------------------------------------------- build

run('npm', ['run', 'build']);
run('npx', ['cap', 'sync', 'android']);

// The ".\" is load-bearing on Windows. A .bat can only be spawned through a shell, and
// cmd.exe does not search the current directory for executables - so a bare
// "gradlew.bat" fails with "not recognized" even though cwd is the android/ folder.
const gradlew = IS_WINDOWS ? '.\\gradlew.bat' : './gradlew';
run(gradlew, ['assembleRelease'], { cwd: join(ROOT, 'android') });

const outDir = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release');
const signedApk = join(outDir, 'app-release.apk');
const unsignedApk = join(outDir, 'app-release-unsigned.apk');

if (!existsSync(signedApk)) {
  if (existsSync(unsignedApk)) {
    // Shipping this would produce an APK Android refuses to install over the existing
    // one, which is precisely the failure the updater exists to avoid.
    die(
      'Gradle produced an UNSIGNED release APK. Configure LOCUS_KEYSTORE_FILE / ' +
        'LOCUS_KEYSTORE_PASSWORD / LOCUS_KEY_ALIAS / LOCUS_KEY_PASSWORD in ' +
        'android/local.properties (see UPDATER.md) and retry.'
    );
  }
  die(`no release APK at ${signedApk}`);
}

// ---------------------------------------------------------------- stage + hash

rmSync(STAGING_DIR, { recursive: true, force: true });
mkdirSync(STAGING_DIR, { recursive: true });
const asset = join(STAGING_DIR, APK_ASSET_NAME);
copyFileSync(signedApk, asset);

const bytes = readFileSync(asset);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const sizeMb = (bytes.length / (1024 * 1024)).toFixed(1);
console.log(`\n  ${APK_ASSET_NAME}  ${sizeMb} MB\n  SHA256: ${sha256}`);

// ---------------------------------------------------------------- release body

const humanNotes = notesFile
  ? readFileSync(resolve(ROOT, notesFile), 'utf8').trim()
  : capture('git', ['log', '--pretty=format:- %s', `v${currentName}..HEAD`]).stdout ||
    capture('git', ['log', '--pretty=format:- %s', '-20']).stdout;

const body = [
  humanNotes,
  '',
  mandatory ? '[MANDATORY]' : null,
  `SHA256: ${sha256}`,
]
  .filter((line) => line !== null)
  .join('\n');

const bodyFile = join(STAGING_DIR, 'RELEASE_NOTES.md');
writeFileSync(bodyFile, body);
console.log(`\n  --- release body ---\n${body}\n  --------------------`);

if (dryRun) {
  console.log(`\n  Dry run complete. Staged at ${STAGING_DIR}. Reverting the version bump.`);
  writeFileSync(GRADLE_FILE, gradle);
  process.exit(0);
}

// ---------------------------------------------------------------- publish

// A baseline release can leave build.gradle untouched, and `git commit` with nothing
// staged exits non-zero - which would abort the run after the APK was already built.
if (gradleChanged) {
  run('git', ['add', GRADLE_FILE]);
  run('git', ['commit', '-m', `chore(release): v${version}`]);
}
run('git', ['push']);

run('gh', [
  'release',
  'create',
  `v${version}`,
  asset,
  '--title',
  `LOCUS v${version}`,
  '--notes-file',
  bodyFile,
]);

if (isBaseline) {
  console.log(`\n  Published the v${version} baseline.`);
  console.log('  Testers must uninstall any existing LOCUS and install this APK by hand -');
  console.log('  it is signed with a different key than the debug builds they have now.');
  console.log(`  Verify it first:  npm run release:verify\n`);
} else {
  console.log(`\n  Published v${version}. Existing installs will be offered it on their next cold start.`);
  console.log(`  Verify it first:  npm run release:verify\n`);
}
