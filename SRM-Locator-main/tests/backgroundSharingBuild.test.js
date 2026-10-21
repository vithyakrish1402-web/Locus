import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

// The real production and test builds, searched. Two promises:
//
//  1. The real "Keep sharing when the app is closed" screen is in production (it is what the
//     release is for), and it is in the test build too.
//  2. Nothing meant only for testing is in production: the earlier temporary switch ("Background
//     sharing (test)", its storage key), the test apps' names, and any mention of the test build's
//     mode. (The test build differs from production in one way only: its updaters are off, so a
//     downloaded bundle can never replace the JavaScript under test.)
//
// Strings that survive minification and exist in exactly one place:
const REAL = [
  'Keep sharing when the app is closed',       // the switch's label (copy/settings.js)
  'Share your location when LOCUS is closed?', // the consent step's title
  'locus.backgroundSharingConsent',            // where the consent is kept
  '/api/background/token',                     // the call that starts sharing
  '/api/background/status',                    // the question whether the server has it on
];
const TEST_ONLY = [
  'Background sharing (test)',     // the old temporary switch's heading
  'locus.backgroundSharingTest',   // its storage key
  'background-sharing-test',       // its test id
  'TEMPORARY - replace with',      // its comments' marker, should a comment ever survive
  'LOCUS RC Test',
  'LOCUS BG Test',
  'rctest',
  'bgtest',
  'sidetest',
];

const out = mkdtempSync(join(tmpdir(), 'locus-bgsharing-build-'));
const dirs = { production: join(out, 'production'), sidetest: join(out, 'sidetest') };

const textOf = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(js|css|html|json)$/.test(e.name))
    .map((e) => readFileSync(join(e.parentPath ?? e.path, e.name), 'utf8'))
    .join('\n');

const text = {};

beforeAll(async () => {
  for (const mode of ['production', 'sidetest']) {
    await build({
      mode,
      logLevel: 'silent',
      build: { outDir: dirs[mode], emptyOutDir: true, reportCompressedSize: false },
    });
    text[mode] = textOf(dirs[mode]);
  }
}, 280_000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('background sharing in the builds', () => {
  it('the real screen is in production and in the test build', () => {
    for (const mode of ['production', 'sidetest']) {
      for (const marker of REAL) expect(text[mode], `${mode}: ${marker}`).toContain(marker);
    }
  });

  it('leaves nothing test-only in production', () => {
    for (const marker of TEST_ONLY) expect(text.production, marker).not.toContain(marker);
    expect(JSON.parse(readFileSync(join(dirs.production, 'locus-build.json'), 'utf8')).mode).toBe('production');
  });

  it('is the same screen in the test build, which differs by its mode marker', () => {
    expect(JSON.parse(readFileSync(join(dirs.sidetest, 'locus-build.json'), 'utf8')).mode).toBe('sidetest');
    for (const marker of ['Background sharing (test)', 'locus.backgroundSharingTest']) expect(text.sidetest, marker).not.toContain(marker);
  });
});
