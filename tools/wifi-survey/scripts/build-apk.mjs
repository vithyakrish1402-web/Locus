// Build the survey tool's debug APK: web build -> cap sync -> gradle assembleDebug, then
// copy the APK next to this package as wifi-survey-debug.apk (gitignored).
//
// Debug-signed on purpose. This tool is never released, so it has no release signing,
// no version bumping and no GitHub release. It is unrelated to SRM-Locator-main/scripts/release*.mjs.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';

// The stock Capacitor template's Gradle 8.14 can't run on JDK 25 (the system JAVA_HOME
// on this machine). Android Studio bundles a JDK 21 and builds with it, so use that when
// it's installed. Override with SURVEY_JAVA_HOME.
const STUDIO_JBR = {
  win32: 'C:\\Program Files\\Android\\Android Studio\\jbr',
  darwin: '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
}[process.platform] ?? '/opt/android-studio/jbr';
const javaHome = process.env.SURVEY_JAVA_HOME || (existsSync(STUDIO_JBR) ? STUDIO_JBR : process.env.JAVA_HOME);

const run = (command, args, { cwd = ROOT, env = process.env } = {}) => {
  console.log(`\n  $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: IS_WINDOWS });
  if (result.status !== 0) {
    console.error(`\n  build-apk: \`${command}\` exited with code ${result.status}\n`);
    process.exit(1);
  }
};

run('npm', ['run', 'build']);
run('npx', ['cap', 'sync', 'android']);

console.log(`\n  Gradle JDK: ${javaHome || '(default on PATH)'}`);
// ".\" matters on Windows: cmd.exe won't run a .bat from the cwd without it.
run(IS_WINDOWS ? '.\\gradlew.bat' : './gradlew', ['assembleDebug'], {
  cwd: join(ROOT, 'android'),
  env: javaHome ? { ...process.env, JAVA_HOME: javaHome } : process.env,
});

const built = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!existsSync(built)) {
  console.error(`\n  build-apk: Gradle finished but ${built} is missing\n`);
  process.exit(1);
}
const out = join(ROOT, 'wifi-survey-debug.apk');
copyFileSync(built, out);
console.log(`\n  APK ready: ${out}\n`);
