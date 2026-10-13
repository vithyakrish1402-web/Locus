import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

// The real production and test builds, searched for the Floor 7 demo. Replaces Stage 6's
// one-time manual look: with the WiFi flag off (every build but the test build), none of the
// WiFi or Floor 7 code, and none of the bundled access points, may be in the output.
//
// The markers are strings that survive minification and exist in exactly one place:
//   wifi_aps         the Firestore collection name, in wifiPositioning.js (the WiFi code itself)
//   floor7-aps-v1    the bundled Floor 7 access point file
//   reacquiring      the position filter's status
//   floor7-debug     the alignment overlay
const MARKERS = ['wifi_aps', 'floor7-aps-v1', 'reacquiring', 'floor7-debug'];

const out = mkdtempSync(join(tmpdir(), 'locus-floor7-build-'));
const dirs = { production: join(out, 'production'), sidetest: join(out, 'sidetest') };

const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name));
const textOf = (dir) => filesUnder(dir).filter((f) => /\.(js|css|html|json)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');

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
}, 240_000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('what ships', () => {
  it('a normal (production) build has the WiFi flag off: none of the WiFi or Floor 7 code is in it', () => {
    expect(JSON.parse(readFileSync(join(dirs.production, 'locus-build.json'), 'utf8')).mode).toBe('production');
    for (const marker of MARKERS) expect(text.production.includes(marker), marker).toBe(false);
  });

  it('the Floor 7 filter, plan and bundled access points never reach it either', () => {
    const names = filesUnder(dirs.production).map((f) => basename(f).toLowerCase());
    expect(names.filter((n) => /floor7|wififusion/.test(n))).toEqual([]);
  });

  it('the test build has the flag on and carries all of it', () => {
    expect(JSON.parse(readFileSync(join(dirs.sidetest, 'locus-build.json'), 'utf8')).mode).toBe('sidetest');
    for (const marker of MARKERS) expect(text.sidetest.includes(marker), marker).toBe(true);
  });
});
