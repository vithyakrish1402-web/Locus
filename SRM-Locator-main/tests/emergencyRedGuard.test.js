// Red only for the Emergency alert and for destructive actions, and no glow (Emergency batch, E7).
// A source-level guard: it reads the app's files, so a red that creeps onto an ordinary screen
// (a notice, a status line, a picture) or a glow that creeps back onto the button fails here.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const root = `${process.cwd()}/src`;
const read = (path) => fs.readFileSync(`${root}/${path}`, 'utf8').replace(/\r\n/g, '\n');

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== 'devtools') walk(path); } else if (/\.(jsx?|css)$/.test(entry.name)) files.push(path);
  }
};
walk(root);
const rel = (file) => file.slice(root.length + 1).replace(/\\/g, '/');

// Anything that draws in the red family: the danger and emergency tokens, Tailwind reds, red hexes.
const RED = /(?:text|bg|border|ring|stroke|fill|outline|from|to|via|shadow)-(?:danger|emergency|red)(?:[-/\w]*)|var\(--color-(?:danger|emergency)[\w-]*\)|#(?:ef4444|dc2626|b91c1c|f87171)\b/gi;

const redIn = (text) => [...text.matchAll(RED)].map((m) => m[0]);

describe('red is for the Emergency alert and destructive actions only', () => {
  // Where red may appear, and why. Everything else in src/ must have none.
  const ALLOWED = {
    'components/SosTrigger.jsx': 'the Emergency button',
    'components/SosOverlay.jsx': 'the received alert (and its Acknowledge button)',
    'components/guide/GuidePictures.jsx': "the guide's picture of the Emergency button (checked below to be that picture only)",
    'components/group/LeaveGroup.jsx': 'Leave group: a destructive action',
    'components/group/MemberOptions.jsx': 'Remove and block: a destructive action',
    'components/ui/Button.jsx': "the danger variant's definition",
    'components/ui/ListRow.jsx': "the danger row's definition",
    'components/ui/NoticeCard.jsx': "the danger notice's definition",
    // Not in the new look yet (the Refresh locations table and the admin tools keep their old
    // red buttons), and the WiFi floor tag's marker colour. Listed so they stay visible.
    'App.jsx': 'the old admin ABORT buttons and the WiFi floor tag colour',
    'components/IndoorMarkers.jsx': 'the WiFi floor tag colour (positioning is off)',
    'components/TacticalLeafletMap.jsx': 'the WiFi floor tag colour (positioning is off)',
    'theme/tokens.css': 'the tokens themselves',
  };

  it('no other file uses red', () => {
    const offenders = files
      .filter((file) => !(rel(file) in ALLOWED))
      .map((file) => [rel(file), redIn(fs.readFileSync(file, 'utf8'))])
      .filter(([, reds]) => reds.length > 0);
    expect(offenders).toEqual([]);
  });

  it("the guide's red is only in the Emergency button's picture", () => {
    const pictures = read('components/guide/GuidePictures.jsx');
    const at = pictures.indexOf('function MiniButton');
    expect(at).toBeGreaterThan(0);
    expect(redIn(pictures.slice(0, at))).toEqual([]);
    expect(redIn(pictures.slice(at)).length).toBeGreaterThan(0);
  });

  it('App.jsx has red only in the old admin buttons and the WiFi floor tag', () => {
    const app = read('App.jsx');
    const lines = app.split('\n').filter((line) => redIn(line).length > 0);
    for (const line of lines) {
      expect(line, line.trim()).toMatch(/FloorTag text=|border-red-500 text-red-500 font-dot/);
    }
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it('the danger button, row and notice are used only by Leave group, Remove and block and the alert screen', () => {
    const users = files
      .filter((file) => !/components\/ui\//.test(rel(file)))
      .filter((file) => /variant="danger"|tone="danger"|^\s+danger\s*$/m.test(read(rel(file))))
      .map(rel)
      .sort();
    expect(users).toEqual(['components/SosOverlay.jsx', 'components/group/LeaveGroup.jsx', 'components/group/MemberOptions.jsx']);
  });

  it("the Emergency notices (held, sent, dropped) are amber or green, never an error's red", () => {
    const app = read('App.jsx');
    expect(app).not.toMatch(/notify\.error\([^)]*(?:SOS_|sosOutbox)/);
    for (const key of ['SOS_HELD.title', 'SOS_DROPPED.gone', 'SOS_DROPPED.left']) {
      expect(app, key).toMatch(new RegExp(`notify\\.warning\\([^;]*${key.replace('.', '\\.')}`));
    }
    expect(app).toMatch(/notify\.success\([^;]*SOS_SENT/);
    // Their copy has no colour of its own.
    expect(redIn(read('copy/emergency.js'))).toEqual([]);
  });

  it('the line on the waiting-for-approval screen is not red', () => {
    const status = read('components/access/StatusScreen.jsx');
    const note = status.slice(status.indexOf('data-testid="emergency-note"'));
    expect(redIn(note.slice(0, note.indexOf('</p>')))).toEqual([]);
  });
});

describe('no glow', () => {
  const GLOW = /glow|drop-shadow|blur-\[|shadow-\[(?!var\(--shadow)|shadow-(?:red|danger|emergency)|ring-offset|animate-pulse|animate-ping|text-shadow/i;

  it('the Emergency files draw no glow, and the button has only the standard shadow', () => {
    for (const path of ['components/SosTrigger.jsx', 'components/SosOverlay.jsx', 'components/guide/GuidePictures.jsx', 'components/access/StatusScreen.jsx']) {
      // Comments may say "no glow"; strip them first.
      const code = read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code.match(GLOW), path).toBeNull();
    }
    expect(read('components/SosTrigger.jsx')).toContain('shadow-[var(--shadow-2)]');
  });

  it('the armed pulse and the alert strobe change opacity only', () => {
    const css = read('index.css');
    for (const name of ['locus-sos-pulse', 'locus-sos-strobe']) {
      const at = css.indexOf(`@keyframes ${name}`);
      expect(at, name).toBeGreaterThan(0);
      const rule = css.slice(at, css.indexOf('\n}\n', at));
      expect(rule, name).not.toMatch(/box-shadow|filter|text-shadow/);
      expect(rule, name).toMatch(/opacity/);
    }
    const armed = css.slice(css.indexOf('.locus-sos-armed'), css.indexOf('@keyframes locus-sos-pulse'));
    expect(armed).not.toMatch(/box-shadow|filter|text-shadow/);
  });

  it('the shadow tokens the button uses are plain, not a red glow', () => {
    const tokens = read('theme/tokens.css');
    const shadows = [...tokens.matchAll(/--shadow-\d:\s*([^;]+);/g)];
    expect(shadows.length).toBeGreaterThan(0);
    for (const m of shadows) expect(m[1], m[0]).not.toMatch(/239|220,\s*38|ef4444|dc2626|red/i);
  });
});
