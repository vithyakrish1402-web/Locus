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
//   floor7-aps-v2    the bundled Floor 7 access point file
//   reacquiring      the position filter's status
//   floor7-debug     the alignment overlay
//   Junction: lab   a station name inside the Floor 7 plan data (floor7-inputs/floor7_plan.json)
//   floor7-recorder, recovered_after_app_closed, Nothing is stored until you press Start
//                    the walk recorder (its panel, its recovery event, its Start line)
const MARKERS = [
  'wifi_aps', 'floor7-aps-v2', 'reacquiring', 'floor7-debug', 'Junction: lab passage / east spine',
  'floor7-recorder', 'recovered_after_app_closed', 'Nothing is stored until you press Start',
];

// The survey CSVs, name table and notes live in floor7-inputs/, outside src/ and public/, so
// no build copies them. These are bytes that appear only in them.
const INPUT_CONTENT = ['wifi_survey_2026', 'survey_name_to_plan_spot', 'DIRECT-03-HP Smart Tank', 'point_id,timestamp,lat,lng'];
const INPUT_FILES = readdirSync(join(process.cwd(), 'floor7-inputs')).filter((f) => !f.startsWith('.'));

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

  it('the Floor 7 inputs folder is in no build: not the survey CSVs, not the name table, not the notes', () => {
    for (const mode of ['production', 'sidetest']) {
      const names = filesUnder(dirs[mode]).map((f) => basename(f));
      for (const input of INPUT_FILES) expect(names, `${mode}: ${input}`).not.toContain(input);
      expect(names.filter((n) => /\.csv$/i.test(n)), mode).toEqual([]);
      for (const bytes of INPUT_CONTENT) expect(text[mode].includes(bytes), `${mode}: ${bytes}`).toBe(false);
    }
  });

  it('the walk-recorder native plugin is in the LOCUS Test source set only, found by name so no other build needs it', () => {
    const java = join(process.cwd(), 'android', 'app', 'src');
    expect(readdirSync(join(java, 'main', 'java', 'com', 'locus', 'app'))).not.toContain('RecorderPlugin.java');
    expect(readdirSync(join(java, 'sidetest', 'java', 'com', 'locus', 'app'))).toContain('RecorderPlugin.java');
    expect(readFileSync(join(java, 'main', 'java', 'com', 'locus', 'app', 'MainActivity.java'), 'utf8')).toContain('Class.forName("com.locus.app.RecorderPlugin")');
    expect(readFileSync(join(java, 'main', 'AndroidManifest.xml'), 'utf8')).not.toContain('recorder_paths');
    expect(readFileSync(join(java, 'sidetest', 'AndroidManifest.xml'), 'utf8')).toContain('recorder_paths');
  });

  it('the test build has the flag on and carries all of it', () => {
    expect(JSON.parse(readFileSync(join(dirs.sidetest, 'locus-build.json'), 'utf8')).mode).toBe('sidetest');
    for (const marker of MARKERS) expect(text.sidetest.includes(marker), marker).toBe(true);
  });
});
