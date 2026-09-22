#!/usr/bin/env node
// Device check for the app's first Firestore read: the gate before WiFi Arc Stage 6.
//
//   npm run device-check:wifi                  # 3 cold starts, then restore the normal build
//   npm run device-check:wifi -- --runs 5
//   npm run device-check:wifi -- --keep        # leave the check build installed afterwards
//
// Builds the app in Vite's `device-check` mode, the only build that contains
// src/devtools/wifiDeviceCheck.js. It installs that as a debug APK over the one on the
// connected phone, force-stops and relaunches it for each run (a true cold start, where
// the auth race is), and reads each run's report back from logcat. Unless --keep is
// given, it then rebuilds and reinstalls the normal debug build, so the phone isn't left
// running the check on every launch.
//
// Needs one phone on adb running a DEBUG LOCUS signed with this PC's debug key, so that
// `adb install -r` upgrades it in place and the signed-in session survives. The phone
// must be signed in and unlocked. Nothing here signs in, uninstalls or clears app data.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = join(ROOT, 'android');
const APK = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APP_ID = 'com.locus.app';
const ACTIVITY = `${APP_ID}/.MainActivity`;
const MARKER = '[LOCUS_WIFI_CHECK]'; // REPORT_MARKER in src/devtools/wifiDeviceCheck.js
const REPORT_TIMEOUT_MS = 60_000;
const IS_WINDOWS = process.platform === 'win32';

// Same spawn rules as release.mjs: .cmd/.bat shims need a shell on Windows, real
// executables (adb) are spawned directly so arguments are never re-split.
const needsShell = (command) =>
  IS_WINDOWS && (/^(npm|npx|yarn|pnpm)$/.test(command) || /\.(cmd|bat)$/i.test(command));

const die = (message) => {
  console.error(`\n  device-check: ${message}\n`);
  process.exit(1);
};

const run = (command, args, options = {}) => {
  console.log(`\n  $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: needsShell(command), ...options });
  if (result.status !== 0) throw new Error(`\`${command} ${args.join(' ')}\` exited with code ${result.status}`);
};

const capture = (command, args) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: needsShell(command), maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stdout: (result.stdout || '').replace(/\r/g, ''), stderr: (result.stderr || '').trim() };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const runsIndex = argv.indexOf('--runs');
const runs = runsIndex === -1 ? 3 : Number(argv[runsIndex + 1]);
const keep = argv.includes('--keep');
if (!Number.isInteger(runs) || runs < 1) die('--runs must be a positive integer');

// ---------------------------------------------------------------- adb + preflight

/** adb from the SDK Gradle already uses (android/local.properties), else ANDROID_HOME, else PATH. */
function findAdb() {
  const exe = IS_WINDOWS ? 'adb.exe' : 'adb';
  const candidates = [];
  const localProps = join(ANDROID_DIR, 'local.properties');
  if (existsSync(localProps)) {
    const sdkDir = /^sdk\.dir=(.*)$/m.exec(readFileSync(localProps, 'utf8'))?.[1];
    // .properties escaping: "C\:\\Users\\..." -> "C:\Users\..."
    if (sdkDir) candidates.push(join(sdkDir.trim().replace(/\\(.)/g, '$1'), 'platform-tools', exe));
  }
  for (const env of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[env]) candidates.push(join(process.env[env], 'platform-tools', exe));
  }
  return candidates.find((p) => existsSync(p)) ?? 'adb';
}

const ADB = findAdb();
const adb = (...args) => capture(ADB, args);

const devices = adb('devices');
if (devices.status !== 0) die(`adb not found or not working (${ADB}). Install the Android SDK platform-tools.`);
const attached = devices.stdout.split('\n').filter((l) => /\tdevice$/.test(l));
if (attached.length !== 1) {
  die(`expected exactly one phone on adb, found ${attached.length}. Connect one, with USB debugging allowed.`);
}

const pkg = adb('shell', 'dumpsys', 'package', APP_ID).stdout;
if (!pkg.includes(`versionCode=`)) die(`${APP_ID} is not installed on the phone.`);
if (!/pkgFlags=\[[^\]]*DEBUGGABLE/.test(pkg)) {
  // A debug APK can't be installed over a release-signed one without uninstalling, which
  // would wipe the signed-in session this check depends on.
  die(`the installed ${APP_ID} is not a debug build. This check installs over a debug build only.`);
}

// capgo resets to an APK's built-in JS only when versionCode changes, and an in-place
// debug install keeps versionCode. So if a downloaded live-update bundle is active, the
// check build's JS would be installed but never run. Refuse instead of reporting nothing.
const webViewSettings = adb('shell', 'run-as', APP_ID, 'cat', 'shared_prefs/CapWebViewSettings.xml').stdout;
const serverBasePath = /name="serverBasePath">([^<]*)</.exec(webViewSettings)?.[1] ?? '';
if (serverBasePath !== '') {
  die(
    `the phone is running a downloaded live-update bundle (${serverBasePath}), not the APK's built-in JS.\n` +
      '  An in-place debug install keeps versionCode, so capgo would keep that bundle and the check\n' +
      '  would never run. Reset the app to its built-in bundle first.'
  );
}

// ---------------------------------------------------------------- build + install

const gradlew = IS_WINDOWS ? '.\\gradlew.bat' : './gradlew';
function buildAndInstall(viteArgs) {
  run('npx', ['vite', 'build', ...viteArgs]);
  run('npx', ['cap', 'sync', 'android']);
  run(gradlew, ['assembleDebug'], { cwd: ANDROID_DIR });
  run(ADB, ['install', '-r', APK]);
}

function extractReport(logcat) {
  const line = logcat.split('\n').find((l) => l.includes(MARKER));
  if (!line) return null;
  return JSON.parse(line.slice(line.indexOf(MARKER) + MARKER.length).trim());
}

async function coldStart(n) {
  adb('shell', 'am', 'force-stop', APP_ID);
  adb('logcat', '-c');
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  adb('shell', 'am', 'start', '-W', '-n', ACTIVITY);
  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1000);
    const report = extractReport(adb('logcat', '-d').stdout);
    if (report) return report;
  }
  const tail = adb('logcat', '-d', '-s', 'Capacitor/Console').stdout.split('\n').slice(-15).join('\n    ');
  console.error(`\n  run ${n}: no report within ${REPORT_TIMEOUT_MS / 1000}s. Is the phone unlocked? Last console lines:\n    ${tail}`);
  return null;
}

function describe(n, r) {
  if (!r) return `  run ${n}: NO REPORT`;
  const f = r.firstRead;
  const lines = [
    `  run ${n}: ${r.verdict}   (check started ${r.msSincePageLoad} ms after page load)`,
    `    auth       signed in at request: ${r.auth.signedInAtRequest}, session restored after ${r.auth.sessionRestoredAfterMs} ms, signed in: ${r.auth.signedIn} (${r.auth.uid})`,
    f.ok
      ? `    first read ${f.ms} ms, ${f.count} APs (expected ${r.expected.count}), ${f.ambiguousFloor} ambiguous (expected ${r.expected.ambiguousFloor}), ${JSON.stringify(f.byBuildingFloor)}`
      : `    first read FAILED after ${f.ms} ms: ${f.error.code} ${f.error.message}`,
    `    cached     same table: ${r.cachedRead.sameTable} (${r.cachedRead.ms} ms)`,
    r.refresh.ok
      ? `    refresh    ${r.refresh.ms} ms, ${r.refresh.count} APs, new table: ${r.refresh.newTable}`
      : `    refresh    FAILED: ${r.refresh.error.code} ${r.refresh.error.message}`,
    r.scan.ok
      ? `    scan       ${r.scan.outcome}, ${r.scan.apCount} APs (${r.scan.ms} ms)`
      : `    scan       ${r.scan.error.code}: ${r.scan.error.message}`,
  ];
  if (r.estimate) {
    lines.push(
      r.estimate.error
        ? `    estimate   FAILED: ${r.estimate.error.code} ${r.estimate.error.message}`
        : `    estimate   ${r.estimate.matchedApCount}/${r.estimate.totalApsSeen} APs matched, ` +
            `${r.estimate.building ?? '-'} floor ${r.estimate.floor ?? '-'}, confidence ${r.estimate.confidence.toFixed(2)}`
    );
  }
  const failed = Object.entries(r.checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) lines.push(`    failed checks: ${failed.join(', ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- main

const reports = [];
let installed = false;
try {
  buildAndInstall(['--mode', 'device-check']);
  installed = true;
  for (let n = 1; n <= runs; n++) {
    console.log(`\n  Cold start ${n}/${runs}...`);
    const report = await coldStart(n);
    reports.push(report);
    console.log(describe(n, report));
    if (report) console.log(`    raw: ${JSON.stringify(report)}`);
  }
} catch (e) {
  console.error(`\n  device-check: ${e.message}`);
} finally {
  if (keep && installed) {
    console.log('\n  --keep: the check build stays installed. Rerun it from DevTools with await __locusWifiCheck.run()');
    console.log('  Restore the normal build later with: npm run build && npx cap sync android, then assembleDebug + adb install -r.');
  } else {
    console.log('\n  Restoring the normal build...');
    try {
      buildAndInstall([]);
      adb('shell', 'am', 'force-stop', APP_ID);
      console.log('  Restored: the phone has the normal debug build, and android/ has production web assets.');
    } catch (e) {
      console.error(`\n  RESTORE FAILED (${e.message}). Run: npm run build && npx cap sync android, then assembleDebug + adb install -r.`);
      process.exitCode = 1;
    }
  }
}

const passed = reports.filter((r) => r?.verdict === 'PASS').length;
console.log(`\n  ${passed}/${runs} cold starts passed.\n`);
if (passed !== runs) process.exitCode = 1;
