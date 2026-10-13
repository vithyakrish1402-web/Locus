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

  it('tells the admin to look for the Settings row, badge and buttons the app really has', () => {
    const read = (f) => readFileSync(join(root, 'src', 'components', f), 'utf8');
    expect(read('devmode/DeveloperModeRow.jsx')).toContain('label="Developer mode"');
    expect(read('devmode/DeveloperBadge.jsx')).toContain('Developer mode on');
    expect(read('Floor7DebugOverlay.jsx')).toContain('Hide the plan');
    expect(read('devmode/ReadyCheck.jsx')).toContain('Start recording');
    expect(read('devmode/ResultsScreen.jsx')).toContain('Share files');
    expect(read('devmode/AdvancedSection.jsx')).toContain('Advanced details');
    for (const text of ['Developer mode', 'Developer mode on', 'Floor 7 map overlay', 'Hide the plan', 'Floor 7 walk test', 'Start recording', 'Share files', 'Previous recordings', 'Advanced details']) {
      expect(doc, text).toContain(text);
    }
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
