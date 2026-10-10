// The design tokens (src/theme/tokens.css) against the redesign handoff's colour table
// (docs/redesign/handoff.md, "Colour roles"), in both themes, plus the contrast the roles
// need to be readable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(new URL('../src/theme/tokens.css', import.meta.url), 'utf8'));

const declsOf = (node) => {
  const out = {};
  node.walkDecls((d) => { out[d.prop] = d.value.replace(/\s*\/\*.*\*\/\s*$/, '').trim(); });
  return out;
};

const themeBlock = css.nodes.find((n) => n.type === 'atrule' && n.name === 'theme');
const light = declsOf(themeBlock);
const darkRule = css.nodes.find((n) => n.type === 'rule' && n.selector === ':root[data-theme="dark"]');
const mediaDark = css.nodes.find((n) => n.type === 'atrule' && n.name === 'media' && n.params.includes('prefers-color-scheme: dark'));
const plainRoot = css.nodes.find((n) => n.type === 'rule' && n.selector === ':root');
const lightAll = { ...light, ...declsOf(plainRoot) };
const darkAll = { ...lightAll, ...declsOf(darkRule) };

// The handoff's table: [token, light, dark]. (The handoff's --accent* are --color-accent*
// here, so Tailwind makes utilities of them.)
const HANDOFF = [
  ['--color-bg', '#F4F6F8', '#0E1116'],
  ['--color-surface', '#FFFFFF', '#161A21'],
  ['--color-raised', '#FFFFFF', '#1E232C'],
  ['--color-sunken', '#EDF0F3', '#12161C'],
  ['--color-border', '#DCE1E7', '#2A303A'],
  /// Both differ from the handoff on purpose (owner's decisions, docs/redesign/handoff.md):
  // light #808A99 (was #8A94A3) and dark #666F7D (was #5F6875) reach 3:1 on every surface.
  ['--color-border-control', '#808A99', '#666F7D'],
  ['--color-text', '#14181F', '#EEF1F5'],
  ['--color-text-secondary', '#566070', '#A3ACB9'],
  ['--color-accent', '#1F4FB8', '#8AB0FF'],
  ['--color-accent-pressed', '#183F94', '#A9C4FF'],
  ['--color-accent-on', '#FFFFFF', '#0B1A3A'],
  ['--color-accent-soft', '#E8EEFA', '#1B2740'],
  ['--color-accent-halo', 'rgba(31, 79, 184, 0.18)', 'rgba(138, 176, 255, 0.22)'],
  ['--color-success', '#1E7B3C', '#5BC77E'],
  ['--color-success-soft', '#E6F4EA', '#15291D'],
  ['--color-warning', '#8F5400', '#F0B44C'],
  ['--color-warning-soft', '#FDF1DE', '#2E2412'],
  ['--color-danger', '#C62828', '#FF6B6B'],
  ['--color-danger-pressed', '#A31F1F', '#FF8A8A'],
  ['--color-danger-on', '#FFFFFF', '#2A0606'],
  ['--color-danger-soft', '#FDECEC', '#3A1717'],
  ['--color-emergency', '#C62828', '#9F1D1D'],
  ['--color-backdrop', 'rgba(20, 24, 31, 0.36)', 'rgba(0, 0, 0, 0.56)'],
  ['--color-map-land', '#EEF0EC', '#171B21'],
  ['--color-map-road', '#FFFFFF', '#262C35'],
  ['--color-map-block', '#DDE1E6', '#20252D'],
  ['--color-map-green', '#D6E8D2', '#18241C'],
  ['--color-map-water', '#CFE0EE', '#142230'],
  ['--color-map-casing', '#FFFFFF', '#0E1116'],
  ['--color-map-plate', 'rgba(255, 255, 255, 0.94)', 'rgba(22, 26, 33, 0.92)'],
  ['--color-map-building', '#566070', '#A3ACB9'],
  ['--color-map-meeting', '#14181F', '#EEF1F5'],
  ['--color-map-last-known', '#8A94A3', '#6B7480'],
  ['--shadow-1', '0 1px 2px rgba(16, 24, 40, 0.06), 0 2px 8px rgba(16, 24, 40, 0.06)', '0 1px 2px rgba(0, 0, 0, 0.4)'],
  ['--shadow-2', '0 2px 4px rgba(16, 24, 40, 0.06), 0 8px 24px rgba(16, 24, 40, 0.12)', '0 8px 24px rgba(0, 0, 0, 0.5)'],
  ['--shadow-3', '0 -4px 12px rgba(16, 24, 40, 0.06), 0 -12px 40px rgba(16, 24, 40, 0.12)', '0 -12px 40px rgba(0, 0, 0, 0.55)'],
];

const norm = (v) => v.toLowerCase().replace(/\s+/g, ' ');

describe('design tokens match the handoff', () => {
  it.each(HANDOFF)('%s: light %s, dark %s', (token, lightValue, darkValue) => {
    expect(norm(lightAll[token] ?? '')).toBe(norm(lightValue));
    expect(norm(darkAll[token] ?? '')).toBe(norm(darkValue));
  });

  it('your dot and the route are the accent, in both themes', () => {
    expect(light['--color-map-self']).toBe('var(--color-accent)');
    expect(light['--color-map-route']).toBe('var(--color-accent)');
  });

  it('dark is the same whether set by the theme script or by the phone alone', () => {
    const fromMedia = declsOf(mediaDark);
    expect(fromMedia).toEqual(declsOf(darkRule));
  });

  it('every colour that changes in dark is a light token too (nothing dark-only)', () => {
    Object.keys(declsOf(darkRule)).forEach((token) => expect(lightAll).toHaveProperty(token));
  });

  it("does not take Tailwind's own corner names, which today's screens use", () => {
    Object.keys(light).forEach((token) => expect(token).not.toMatch(/^--radius-(xs|sm|md|lg|xl|2xl|3xl|4xl)$/));
  });
});

// WCAG relative luminance and contrast, for opaque #RRGGBB colours.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('contrast, both themes', () => {
  // [foreground, background, minimum]: 4.5 for text, 3 for control outlines.
  const PAIRS = [
    ['--color-text', '--color-bg', 4.5],
    ['--color-text', '--color-surface', 4.5],
    ['--color-text', '--color-raised', 4.5],
    ['--color-text-secondary', '--color-bg', 4.5],
    ['--color-text-secondary', '--color-surface', 4.5],
    ['--color-text-secondary', '--color-sunken', 4.5],
    ['--color-accent-on', '--color-accent', 4.5],
    ['--color-accent', '--color-surface', 4.5],
    ['--color-danger-on', '--color-danger', 4.5],
    ['--color-warning', '--color-surface', 4.5],
    ['--color-warning', '--color-warning-soft', 4.5],
    ['--color-success', '--color-surface', 4.5],
    ['--color-border-control', '--color-surface', 3],
    ['--color-border-control', '--color-bg', 3],
    ['--color-border-control', '--color-sunken', 3],
    ['--color-border-control', '--color-raised', 3],
  ];
  for (const [theme, values] of [['light', lightAll], ['dark', darkAll]]) {
    it.each(PAIRS)(`${theme}: %s on %s at least %s:1`, (fg, bg, min) => {
      expect(contrast(values[fg], values[bg])).toBeGreaterThanOrEqual(min);
    });
  }

  it('white text on the received-alert band reads in both themes', () => {
    expect(contrast('#FFFFFF', lightAll['--color-emergency'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#FFFFFF', darkAll['--color-emergency'])).toBeGreaterThanOrEqual(4.5);
  });
});
