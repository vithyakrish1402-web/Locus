// @vitest-environment jsdom
//
// The inline script in index.html sets <html data-theme> before first paint, so the wrong
// theme never flashes. It can't import src/theme/theme.js, so it repeats the rule. This runs
// the real script from index.html against every case and checks it lands where theme.js does.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTheme, THEME_STORAGE_KEY } from '../src/theme/theme.js';

const html = readFileSync(fileURLToPath(new globalThis.URL('../index.html', import.meta.url)), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const prePaint = scripts.find((s) => s.includes(THEME_STORAGE_KEY));

// What theme.js's getThemePreference would make of a stored value.
const preferenceFor = (saved) => (['system', 'light', 'dark'].includes(saved) ? saved : 'system');

const run = ({ saved, storageThrows = false, prefersDark, noMatchMedia = false }) => {
  delete document.documentElement.dataset.theme;
  const storage = {
    getItem: (key) => {
      if (storageThrows) throw new Error('SecurityError');
      return key === THEME_STORAGE_KEY ? saved ?? null : null;
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => storage });
  window.matchMedia = noMatchMedia ? undefined : () => ({ matches: prefersDark });
  new Function(prePaint)();
  return document.documentElement.getAttribute('data-theme');
};

beforeEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('the pre-paint theme script in index.html', () => {
  it('exists, and runs before the app is loaded', () => {
    expect(prePaint).toBeTruthy();
    expect(html.indexOf(prePaint)).toBeLessThan(html.indexOf('src="/src/main.jsx"'));
    expect(html.indexOf(prePaint)).toBeLessThan(html.indexOf('</head>'));
  });

  const cases = [];
  for (const saved of [undefined, 'system', 'light', 'dark', 'tactical']) {
    for (const prefersDark of [false, true]) cases.push({ saved, prefersDark });
  }

  it.each(cases)('saved=$saved, phone dark=$prefersDark: same theme as theme.js', ({ saved, prefersDark }) => {
    expect(run({ saved, prefersDark })).toBe(resolveTheme(preferenceFor(saved), prefersDark));
  });

  it('falls back to the phone when storage cannot be read', () => {
    expect(run({ storageThrows: true, prefersDark: true })).toBe('dark');
    expect(run({ storageThrows: true, prefersDark: false })).toBe('light');
  });

  it('is light when the phone cannot be asked and nothing is saved', () => {
    expect(run({ noMatchMedia: true })).toBe('light');
    expect(run({ saved: 'dark', noMatchMedia: true })).toBe('dark');
  });
});
