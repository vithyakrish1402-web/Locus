#!/usr/bin/env node
// The side-by-side test build: the real app as "LOCUS Test" (app ID com.locus.app.sidetest),
// installed next to LOCUS on a USB-connected phone. Publishes nothing.
//
//   npm run sidetest:install                 # build, install on the one phone on adb
//   npm run sidetest:install -- --build-only # build the APK, install nothing
//
// It builds the web app in Vite's 'sidetest' mode, where both updaters are off
// (src/utils/buildMode.js), syncs it into the Android project, assembles the debug-signed
// `sidetest` build type (android/app/build.gradle) and installs it with `adb install -r`,
// which only ever replaces an earlier LOCUS Test. LOCUS itself is not touched: a different
// app ID is a different app to Android.
//
// The test JavaScript must never reach a release. So whatever happens, this script ends by
// putting a production web build back into dist/ and the Android project; and the release
// scripts and the Android release build refuse any web build that isn't production
// (scripts/lib/webBuild.mjs, android/app/build.gradle).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildMode } from './lib/webBuild.mjs';

// --bgtest: the same build, as the separate app "LOCUS BG Test" (com.locus.app.bgtest), so it can sit
// next to LOCUS Test without replacing it.
const variant = process.argv.includes('--bgtest') ? 'bgtest' : 'sidetest';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = join(ROOT, 'android');
const WEB_ASSETS = join(ANDROID_DIR, 'app', 'src', 'main', 'assets', 'public');
const APK = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
const IS_WINDOWS = process.platform === 'win32';
const buildOnly = process.argv.includes('--build-only');

// Same spawn rules as release.mjs: .cmd/.bat shims need a shell on Windows, real
// executables (adb) are spawned directly so arguments are never re-split.
const needsShell = (command) =>
  IS_WINDOWS && (/^(npm|npx|yarn|pnpm)$/.test(command) || /\.(cmd|bat)$/i.test(command));

const run = (command, args, options = {}) => {
  console.log(`\n  $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: needsShell(command), ...options });
  if (result.status !== 0) throw new Error(`\`${command} ${args.join(' ')}\` exited with code ${result.status}`);
};

const capture = (command, args) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: needsShell(command) });
  return { status: result.status, stdout: (result.stdout || '').replace(/\r/g, '') };
};

/** adb from the SDK Gradle already uses (android/local.properties), else ANDROID_HOME, else PATH. */
function findAdb() {
  const exe = IS_WINDOWS ? 'adb.exe' : 'adb';
  const candidates = [];
  const localProps = join(ANDROID_DIR, 'local.properties');
  if (existsSync(localProps)) {
    const sdkDir = /^sdk\.dir=(.*)$/m.exec(readFileSync(localProps, 'utf8'))?.[1];
    if (sdkDir) candidates.push(join(sdkDir.trim().replace(/\\(.)/g, '$1'), 'platform-tools', exe));
  }
  for (const env of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[env]) candidates.push(join(process.env[env], 'platform-tools', exe));
  }
  return candidates.find((p) => existsSync(p)) ?? 'adb';
}

const fail = (message) => {
  console.error(`\n  sidetest: ${message}\n`);
  process.exitCode = 1;
};

const adb = findAdb();
if (!buildOnly) {
  const devices = capture(adb, ['devices']).stdout.split('\n').slice(1).filter((l) => /\tdevice$/.test(l));
  if (devices.length !== 1) {
    fail(devices.length === 0
      ? 'no phone on adb. Connect it by USB, turn on USB debugging and allow this computer.'
      : 'more than one phone on adb. Connect only the one to install on.');
    process.exit();
  }
}

const gradlew = IS_WINDOWS ? '.\\gradlew.bat' : './gradlew';
try {
  run('npx', ['vite', 'build', '--mode', 'sidetest']);
  if (readBuildMode(join(ROOT, 'dist')) !== 'sidetest') throw new Error('the web build is not the sidetest build');
  run('npx', ['cap', 'sync', 'android']);
  run(gradlew, [variant === 'bgtest' ? 'assembleBgtest' : 'assembleSidetest'], { cwd: ANDROID_DIR });
  if (!existsSync(APK)) throw new Error(`no APK at ${APK}`);
  if (buildOnly) {
    console.log(`\n  Built ${APK}\n  (--build-only: nothing installed)`);
  } else {
    run(adb, ['install', '-r', APK]);
    console.log('\n  LOCUS Test is installed next to LOCUS. Open it from the app drawer and sign in.');
  }
} catch (e) {
  fail(e.message);
} finally {
  // Never leave test JavaScript where a release could pick it up.
  console.log('\n  Putting the production web build back');
  try {
    run('npm', ['run', 'build']);
    run('npx', ['cap', 'sync', 'android']);
    if (readBuildMode(WEB_ASSETS) !== 'production') throw new Error('the Android web assets are still not production');
  } catch (e) {
    fail(`could not restore the production web build (${e.message}). Run \`npm run build\` and \`npx cap sync android\` before any release.`);
  }
}
