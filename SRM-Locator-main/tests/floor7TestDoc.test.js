import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// FLOOR7_TEST.md is the plain-language guide for the test phone. It names scripts, files,
// npm commands and a button; this fails when one of them is renamed and the guide is not.
const root = process.cwd();
const doc = readFileSync(join(root, 'FLOOR7_TEST.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('FLOOR7_TEST.md', () => {
  it('names only scripts and files that exist', () => {
    const paths = [...doc.matchAll(/(?:scripts\/[\w-]+\.mjs|floor7-inputs\/[\w.-]+\.(?:csv|json)|floor7-reports\/[\w.]+\.md|src\/data\/[\w.]+\.json)/g)].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(5);
    for (const p of new Set(paths)) expect(existsSync(join(root, p)), p).toBe(true);
  });

  it('uses npm scripts that exist', () => {
    expect(doc).toContain('npm run sidetest:install');
    expect(pkg.scripts['sidetest:install']).toBeTruthy();
  });

  it('tells the owner to look for the button the overlay really has', () => {
    const overlay = readFileSync(join(root, 'src', 'components', 'Floor7DebugOverlay.jsx'), 'utf8');
    expect(overlay).toContain('F7 {open');
    expect(doc).toContain('**F7 debug**');
    expect(overlay).toContain('left-2 bottom-24'); // bottom left, above the bar
  });

  it('reads the log the app prints with the tag and marker the app uses', () => {
    expect(doc).toContain('adb logcat -d -s Capacitor/Console');
    expect(readFileSync(join(root, 'scripts', 'device-check-wifi.mjs'), 'utf8')).toContain("'Capacitor/Console'");
    expect(readFileSync(join(root, 'src', 'utils', 'floor7Demo.js'), 'utf8')).toContain("FIX_LOG_MARKER = '[F7]'");
  });

  it('quotes the jump limit line exactly as it is in the filter, and holds no personal email address', () => {
    const line = 'export const MAX_JUMP_M = 25;';
    expect(readFileSync(join(root, 'src', 'utils', 'positionFilter.js'), 'utf8')).toContain(line);
    expect(doc).toContain(line);
    expect(doc).not.toMatch(/[\w.]+@[\w.]+/);
  });

  it('lists the settings file the worktree lacks as git-ignored', () => {
    expect(readFileSync(join(root, 'android', '.gitignore'), 'utf8')).toMatch(/^local\.properties$/m);
  });
});
