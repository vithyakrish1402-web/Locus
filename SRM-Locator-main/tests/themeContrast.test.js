import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Text must be readable in both themes: WCAG AA, 4.5:1 for text, 3:1 for icons and large text.
 * Reads the colours straight out of src/theme/tokens.css, so a token changed to something
 * unreadable fails here. Also pins the two things that made the member options sheet unreadable
 * in Light (its titles about 1:1 on the panel): a panel colour of its own instead of the theme's,
 * and `dark:` utilities that followed the phone's setting instead of the app's theme.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tokensCss = read('../src/theme/tokens.css');

// The --color-* values of one block of tokens.css (light: the @theme block; dark: the data-theme one).
function tokens(selector) {
  const start = tokensCss.indexOf(selector);
  const body = tokensCss.slice(tokensCss.indexOf('{', start) + 1, tokensCss.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/--color-([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}
const THEMES = { light: tokens('@theme static'), dark: tokens(':root[data-theme="dark"]') };

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (top, alpha, bottom) => top.map((c, i) => c * alpha + bottom[i] * (1 - alpha));
const luminance = (c) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [what, foreground token, background token, minimum]
const PAIRS = [
  ['sheet title', 'text', 'surface', 4.5],
  ['sheet subtitle', 'text-secondary', 'surface', 4.5],
  ['title on a raised panel', 'text', 'raised', 4.5],
  ['subtitle on a raised panel', 'text-secondary', 'raised', 4.5],
  ['Cancel button label (secondary)', 'text', 'sunken', 4.5],
  ['stat chip label', 'text-secondary', 'sunken', 4.5],
  ['danger row title', 'danger', 'surface', 4.5],
  ['row icon (accent)', 'accent', 'surface', 3],
  ['Live now badge', 'success', 'success-soft', 4.5],
  ['Signal lost badge', 'warning', 'warning-soft', 4.5],
  ['role tag', 'accent', 'accent-soft', 4.5],
  ['Trusted friend tag', 'success', 'success-soft', 4.5],
  ['text on the page', 'text-secondary', 'bg', 4.5],
];

describe.each(Object.keys(THEMES))('%s theme', (theme) => {
  const t = THEMES[theme];
  it.each(PAIRS)('%s is readable', (_what, fg, bg, min) => {
    expect(t[fg], `--color-${fg}`).toMatch(/^#/);
    expect(t[bg], `--color-${bg}`).toMatch(/^#/);
    expect(contrast(rgb(t[fg]), rgb(t[bg]))).toBeGreaterThanOrEqual(min);
  });

  it('SOS tab label (danger-pressed on a 15 % danger tint) is readable', () => {
    const tint = mix(rgb(t.danger), 0.15, rgb(t.surface));
    expect(contrast(rgb(t['danger-pressed']), tint)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the member options sheet', () => {
  const sheet = read('../src/components/group/MemberOptions.jsx');

  it('takes every colour from the theme, none of its own', () => {
    expect(sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sheet).not.toMatch(/\btext-(white|black|gray-\d+)\b/);
    expect(sheet).not.toMatch(/!bg-|!border-/);
    expect(sheet).toMatch(/solidPanelClass = '[^']*\bbg-surface\b/);
  });
});

describe('dark: utilities', () => {
  it('follow the app\'s theme attribute, not only the phone\'s setting', () => {
    const css = read('../src/index.css');
    expect(css).toMatch(/@custom-variant dark\s*\{[^]*?\[data-theme="dark"\][^]*?@slot/);
  });
});

describe('the SOS tab at rest', () => {
  it('uses the colour checked above (danger-pressed on the danger tint)', () => {
    expect(read('../src/components/SosTrigger.jsx')).toMatch(/idle: 'bg-danger\/15 text-danger-pressed /);
  });
});

describe('the Cancel button (secondary)', () => {
  it('is theme ink on the sunken colour', () => {
    const button = read('../src/components/ui/Button.jsx');
    expect(button).toMatch(/secondary: 'bg-sunken text-text /);
  });
});
