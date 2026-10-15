import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

// The real production and LOCUS Test builds, searched for the background sharing test switch.
// In every build but LOCUS Test (Vite mode 'sidetest') none of the switch, the hook behind it,
// its words or its storage key may be in the output. LOCUS Test must have all of them, or the
// check proves nothing.
//
// Strings that survive minification and exist in exactly one place:
//   Background sharing (test)               the switch's heading (BackgroundSharingTestSwitch.jsx)
//   Keep sharing when the app is closed     the switch's label
//   background-sharing-test                 its test id
//   locus.backgroundSharingTest             the localStorage key holding the switch (the hook)
//   /api/background/token                   the call that starts sharing (backgroundSharing.js)
//   Location and notification permission    the switch's explanation of a refusal
const MARKERS = [
  'Background sharing (test)',
  'Keep sharing when the app is closed',
  'background-sharing-test',
  'locus.backgroundSharingTest',
  '/api/background/token',
  'Location and notification permission',
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

describe('the background sharing test switch', () => {
  it('is in the LOCUS Test build (so the search below means something)', () => {
    for (const marker of MARKERS) expect(text.sidetest, marker).toContain(marker);
    expect(JSON.parse(readFileSync(join(dirs.sidetest, 'locus-build.json'), 'utf8')).mode).toBe('sidetest');
  });

  it('leaves no trace in a production build', () => {
    for (const marker of MARKERS) expect(text.production, marker).not.toContain(marker);
    expect(JSON.parse(readFileSync(join(dirs.production, 'locus-build.json'), 'utf8')).mode).toBe('production');
  });
});
