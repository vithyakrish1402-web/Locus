#!/usr/bin/env node
// Verify a PUBLISHED release the way a device would, before any tester sees it.
//
//   npm run release:verify              # latest v*  (Phase 1 APK)
//   npm run release:verify -- --bundle  # latest js-* (Phase 2 JS bundle)
//
// Every check here answers a failure that is otherwise only discoverable on a phone,
// usually after it has already been handed out. It deliberately imports the SAME
// parsing modules the app uses (src/utils/updateManifest.js and liveUpdateManifest.js)
// rather than re-implementing them, so "the verifier passed" means the client will
// parse it identically - a second implementation could agree with the release and
// still disagree with the app.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APK_ASSET_NAME, parseReleaseManifest } from '../src/utils/updateManifest.js';
import { BUNDLE_ASSET_NAME, selectLatestBundleRelease } from '../src/utils/liveUpdateManifest.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRADLE_FILE = join(ROOT, 'android', 'app', 'build.gradle');
const SCRATCH = join(ROOT, 'dist-release', '_verify');
const REPO = process.env.VITE_UPDATE_REPO || 'vithyakrish1402-web/Locus';
const IS_WINDOWS = process.platform === 'win32';

let failures = 0;
let warnings = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const warn = (msg) => {
  warnings += 1;
  console.log(`  WARN  ${msg}`);
};

// Thrown rather than process.exit()ing: calling exit() while undici still holds a live
// socket trips a libuv assertion on Windows, which prints an alarming crash dump after
// a perfectly ordinary "no release yet" message.
class Abort extends Error {}
const die = (msg) => {
  throw new Abort(msg);
};

const capture = (command, args) => {
  const r = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: false });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
};

/** Read zip entry names straight out of the central directory - no dependency needed. */
const zipEntryNames = (buffer) => {
  const names = [];
  const sig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let i = 0;
  while ((i = buffer.indexOf(sig, i)) !== -1) {
    const n = buffer.readUInt16LE(i + 28);
    names.push(buffer.toString('utf8', i + 46, i + 46 + n));
    i += 46 + n;
  }
  return names;
};

/** Newest aapt2 in the local SDK, or null. Used for the APK-vs-tag version check. */
const findAapt2 = () => {
  const localProps = join(ROOT, 'android', 'local.properties');
  if (!existsSync(localProps)) return null;
  const sdkDir = /^sdk\.dir=(.*)$/m.exec(readFileSync(localProps, 'utf8'))?.[1]?.replace(/\\\\/g, '\\');
  if (!sdkDir) return null;
  const buildTools = join(sdkDir, 'build-tools');
  if (!existsSync(buildTools)) return null;
  for (const v of readdirSync(buildTools).sort().reverse()) {
    const candidate = join(buildTools, v, IS_WINDOWS ? 'aapt2.exe' : 'aapt2');
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

async function main() {
  const bundleMode = process.argv.includes('--bundle');

  console.log(`\n  Verifying the latest ${bundleMode ? 'JS bundle (js-*)' : 'APK (v*)'} release of ${REPO}\n`);

  // ------------------------------------------------------------ fetch the release
  const api = bundleMode
    ? `https://api.github.com/repos/${REPO}/releases?per_page=30`
    : `https://api.github.com/repos/${REPO}/releases/latest`;

  const response = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
  if (response.status === 404) die('no release published yet - cut one first');
  if (response.status === 403 || response.status === 429) die('GitHub rate limit reached; try again shortly');
  if (!response.ok) die(`GitHub returned HTTP ${response.status}`);
  const payload = await response.json();

  // ------------------------------------------------------------ parse it as the app does
  let manifest;
  if (bundleMode) {
    manifest = selectLatestBundleRelease(payload);
    if (!manifest) {
      die(`no usable js-* release found (needs a ${BUNDLE_ASSET_NAME} asset plus SHA256 and MIN_NATIVE lines)`);
    }
    pass(`parsed as a bundle release: ${manifest.tag}`);
  } else {
    const parsed = parseReleaseManifest(payload);
    // Reporting the app's own verdict: if the client would refuse this release, there is
    // nothing further worth checking against a manifest it will never read.
    if (!parsed.ok) die(`the app would REJECT this release: ${parsed.reason}`);
    manifest = parsed.manifest;
    pass(`parsed as an APK release: ${manifest.tag}`);
  }

  console.log('');
  console.log(`  version     ${manifest.version}`);
  console.log(`  asset       ${bundleMode ? manifest.zipUrl : manifest.apkUrl}`);
  console.log(`  sha256      ${manifest.sha256}`);
  console.log(
    bundleMode
      ? `  minNative   ${manifest.minNative}`
      : `  mandatory   ${manifest.mandatory ? 'YES - clients will be locked until they install it' : 'no'}`
  );
  console.log('');

  // ------------------------------------------------------------ download + checksum
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  const assetName = bundleMode ? BUNDLE_ASSET_NAME : APK_ASSET_NAME;
  const assetPath = join(SCRATCH, assetName);

  const assetResponse = await fetch(bundleMode ? manifest.zipUrl : manifest.apkUrl, {
    headers: { Accept: 'application/octet-stream' },
  });
  if (!assetResponse.ok) die(`could not download ${assetName}: HTTP ${assetResponse.status}`);
  const bytes = Buffer.from(await assetResponse.arrayBuffer());
  writeFileSync(assetPath, bytes);
  pass(`downloaded ${assetName} (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`);

  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual === manifest.sha256) {
    pass('SHA-256 matches the published checksum');
  } else {
    // The most important check here: a mismatch means every device rejects the install
    // after spending the entire download, and the only symptom is the integrity error.
    fail(`SHA-256 MISMATCH - published ${manifest.sha256}, actual ${actual}`);
  }

  if (!bundleMode) {
    // Does the APK's own versionName agree with the tag? If the tag says 1.1.0 but the
    // binary says 1.0.0, App.getInfo() keeps reporting the old version after install and
    // the updater re-offers the same release forever. Silent, and awful to debug.
    const aapt2 = findAapt2();
    if (aapt2) {
      const badging = capture(aapt2, ['dump', 'badging', assetPath]);
      const versionName = /versionName='([^']*)'/.exec(badging.stdout)?.[1];
      const versionCode = /versionCode='([^']*)'/.exec(badging.stdout)?.[1];
      if (!versionName) warn('could not read versionName out of the APK');
      else if (versionName === manifest.version) {
        pass(`APK versionName (${versionName}, code ${versionCode}) matches the tag`);
      } else {
        fail(
          `APK versionName is ${versionName} but the tag says ${manifest.version} - ` +
            'devices would install it and then be re-offered the same update forever'
        );
      }
    } else {
      warn('aapt2 not found in the Android SDK - skipped the versionName/tag cross-check');
    }

    // Signing certificate. Android refuses an update whose signature differs from the
    // installed app, so this fingerprint must match every previous release's.
    const cert = capture('keytool', ['-printcert', '-jarfile', assetPath]);
    const fingerprint = cert.status === 0 ? /SHA256:\s*([0-9A-F:]+)/i.exec(cert.stdout)?.[1] : null;
    if (cert.status !== 0) {
      warn('keytool unavailable - could not read the signing certificate');
    } else if (fingerprint) {
      pass('signed; certificate SHA-256 fingerprint:');
      console.log(`        ${fingerprint}`);
      const owner = /Owner:\s*(.*)/.exec(cert.stdout)?.[1];
      if (owner) console.log(`        owner: ${owner}`);
      console.log('        ^ must match every other release, or installs are refused');
    } else {
      fail('APK appears UNSIGNED - Android will refuse to install it as an update');
    }
  }

  if (bundleMode) {
    // index.html must sit at the archive ROOT with forward-slash paths, or the WebView
    // swaps to a bundle that cannot find its own scripts - a white screen on device.
    const names = zipEntryNames(bytes);
    if (names.includes('index.html')) pass('index.html is at the zip root');
    else fail('index.html is NOT at the zip root - the bundle would not boot');

    const backslashed = names.filter((n) => n.includes(String.fromCharCode(92)));
    if (backslashed.length === 0) pass('all zip entries use forward slashes');
    else fail(`${backslashed.length} zip entries use backslash separators - Android unzips them flat`);

    // A bundle gated above the shell it was built from can never be applied by anyone.
    const nativeName = /versionName\s+"([^"]+)"/.exec(readFileSync(GRADLE_FILE, 'utf8'))?.[1];
    if (nativeName) {
      const t = (v) => v.split('.').map(Number);
      const [a1, a2, a3] = t(manifest.minNative);
      const [b1, b2, b3] = t(nativeName);
      if (a1 > b1 || (a1 === b1 && (a2 > b2 || (a2 === b2 && a3 > b3)))) {
        fail(`MIN_NATIVE ${manifest.minNative} is newer than the local native shell ${nativeName} - no device can apply this bundle`);
      } else {
        pass(`MIN_NATIVE ${manifest.minNative} is satisfied by the current native shell ${nativeName}`);
      }
    }
  }

  rmSync(SCRATCH, { recursive: true, force: true });

  console.log('');
  if (failures > 0) {
    console.log(`  ${failures} FAILURE(S)${warnings ? `, ${warnings} warning(s)` : ''} - do not hand this release out.\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`  All checks passed${warnings ? ` (${warnings} warning(s))` : ''}.\n`);
}

try {
  await main();
} catch (error) {
  rmSync(SCRATCH, { recursive: true, force: true });
  if (error instanceof Abort) {
    console.error(`\n  release:verify: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
