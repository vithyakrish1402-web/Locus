// @vitest-environment jsdom
//
// The light/dark theme choice (src/theme/theme.js): System (the default) follows the phone,
// Light and Dark override it, the choice is kept on the phone, and the theme lands on
// <html data-theme> where the design tokens read it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  THEME_STORAGE_KEY,
  __resetTheme,
  getThemePreference,
  installTheme,
  resolveTheme,
  setThemePreference,
  subscribeTheme,
} from '../src/theme/theme.js';

// A controllable prefers-color-scheme: flip `dark` and fire `change`, as the phone does.
let media;
const mockSystem = (dark) => {
  const listeners = new Set();
  media = {
    matches: dark,
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
    listeners,
    flip(toDark) {
      this.matches = toDark;
      listeners.forEach((fn) => fn({ matches: toDark }));
    },
  };
  window.matchMedia = vi.fn(() => media);
};

const shown = () => document.documentElement.dataset.theme;

// Every installTheme() in a test is undone after it: its listeners are on the shared document.
const installed = [];
const install = () => {
  const stop = installTheme();
  installed.push(stop);
  return stop;
};

beforeEach(() => {
  localStorage.clear();
  __resetTheme();
  delete document.documentElement.dataset.theme;
  mockSystem(false);
});

afterEach(() => {
  installed.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
});

describe('resolveTheme', () => {
  it.each([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
  ])('%s with the phone dark=%s shows %s', (preference, prefersDark, expected) => {
    expect(resolveTheme(preference, prefersDark)).toBe(expected);
  });
});

describe('the saved choice', () => {
  it('is System when nothing is saved, or something unknown is', () => {
    expect(getThemePreference()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'tactical');
    expect(getThemePreference()).toBe('system');
  });

  it('is saved, shown at once, and announced', () => {
    install();
    const seen = [];
    subscribeTheme((t) => seen.push(t));

    setThemePreference('dark');

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(shown()).toBe('dark');
    expect(seen.at(-1)).toEqual({ preference: 'dark', theme: 'dark' });
  });

  it('ignores a value that is not a choice', () => {
    setThemePreference('dark');
    setThemePreference('blue');
    expect(getThemePreference()).toBe('dark');
  });

  it('still holds for this session when it cannot be saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    install();

    setThemePreference('dark');

    expect(shown()).toBe('dark');
    expect(getThemePreference()).toBe('dark');
  });

  it('is System when storage cannot even be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    mockSystem(true);
    install();
    expect(getThemePreference()).toBe('system');
    expect(shown()).toBe('dark');
  });
});

describe('following the phone', () => {
  it('on System, switches as the phone switches', () => {
    install();
    expect(shown()).toBe('light');

    media.flip(true);
    expect(shown()).toBe('dark');

    media.flip(false);
    expect(shown()).toBe('light');
  });

  it('on Light or Dark, ignores the phone', () => {
    install();
    setThemePreference('light');

    media.flip(true);
    expect(shown()).toBe('light');
  });

  it('back on System, follows the phone again from where it is now', () => {
    install();
    setThemePreference('light');
    media.flip(true);

    setThemePreference('system');
    expect(shown()).toBe('dark');
  });

  it('on System, catches a change made while the app was in the background', () => {
    install();
    // The phone switched to dark with no change event (Android keeps LOCUS running).
    media.matches = true;
    expect(shown()).toBe('light');

    document.dispatchEvent(new Event('visibilitychange'));
    expect(shown()).toBe('dark');
  });

  it('stops following when uninstalled', () => {
    const stop = install();
    stop();
    expect(media.listeners.size).toBe(0);
    media.matches = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(shown()).toBe('light');
  });

  it('works where the phone cannot be asked (no matchMedia): light', () => {
    window.matchMedia = undefined;
    install();
    expect(shown()).toBe('light');
  });
});
