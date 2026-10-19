// @vitest-environment jsdom
//
// The theme switch (src/theme/theme.js): one effect per switch, picked per phone; the theme
// applied once, under the cover, with element transitions off; the cover held until the
// map has redrawn; rapid taps and failures never leaving a half-done screen; the phone
// moved down a tier after a slow switch and up only after proving fast; the status bar
// following the theme. And the CSS rule whose absence made the old theme flash back.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const native = vi.hoisted(() => ({ isNative: false, setStyle: vi.fn(() => Promise.resolve()) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.isNative } }));
vi.mock('@capacitor/status-bar', () => ({ StatusBar: { setStyle: native.setStyle }, Style: { Dark: 'DARK', Light: 'LIGHT' } }));

import {
  __resetTheme, installTheme, getThemeTransitionTier, registerThemeSettle, registerThemePrepare,
  switchThemePreference, toggleTheme, THEME_SLOW_APPLY_MS,
} from '../src/theme/theme';

const root = document.documentElement;
const STATE_KEY = 'locus.themeTransition';
const cover = () => document.querySelector('[data-theme-cover]');
const state = () => JSON.parse(localStorage.getItem(STATE_KEY) || '{}');

// requestAnimationFrame with a frame length the test picks: what watchFrames measures.
let frameMs = 16;
let clock = 0;
function fakeFrames() {
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(() => { clock += frameMs; fn(clock); }, 0));
}

function capablePhone({ cores = 8, memory = 8 } = {}) {
  Object.defineProperty(navigator, 'hardwareConcurrency', { value: cores, configurable: true });
  Object.defineProperty(navigator, 'deviceMemory', { value: memory, configurable: true });
}

// A View Transitions stand-in: runs the update, then finishes once the test says so.
function fakeViewTransitions() {
  const calls = [];
  document.startViewTransition = (update) => {
    let finish;
    const finished = new Promise((r) => { finish = r; });
    const updated = Promise.resolve().then(update);
    const call = { update, finish, ready: updated.then(() => undefined), finished, updateCallbackDone: updated };
    calls.push(call);
    return call;
  };
  root.animate = vi.fn(() => ({ finished: Promise.resolve() }));
  return calls;
}

let themeWrites;
let observer;

beforeEach(() => {
  __resetTheme();
  localStorage.clear();
  delete root.dataset.theme;
  root.className = '';
  document.body.innerHTML = '';
  delete document.startViewTransition;
  delete root.animate;
  window.history.replaceState(null, '', '/');
  window.matchMedia = undefined;
  capablePhone({ cores: 2, memory: 2 });
  frameMs = 16;
  native.isNative = false;
  native.setStyle.mockClear();
  fakeFrames();
  localStorage.setItem('locus.theme', 'light');
  installTheme();
  themeWrites = [];
  observer = new MutationObserver((ms) => ms.forEach(() => themeWrites.push(root.dataset.theme)));
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
});

afterEach(() => {
  observer.disconnect();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('which effect a phone gets', () => {
  it('is the cover by default, even on a phone with the API, cores and memory', () => {
    fakeViewTransitions();
    capablePhone();
    expect(getThemeTransitionTier()).toBe('light');
  });

  it('is the circular reveal only once a capable phone has been fast twice', () => {
    fakeViewTransitions();
    capablePhone();
    localStorage.setItem(STATE_KEY, JSON.stringify({ fast: 1 }));
    expect(getThemeTransitionTier()).toBe('light');
    localStorage.setItem(STATE_KEY, JSON.stringify({ fast: 2 }));
    expect(getThemeTransitionTier()).toBe('full');
  });

  it('never the reveal without the API, the cores or the memory', () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ fast: 5 }));
    capablePhone();
    expect(getThemeTransitionTier()).toBe('light'); // no View Transitions
    fakeViewTransitions();
    capablePhone({ cores: 4, memory: 8 });
    expect(getThemeTransitionTier()).toBe('light');
    capablePhone({ cores: 8, memory: 2 });
    expect(getThemeTransitionTier()).toBe('light');
    capablePhone({ cores: 8, memory: null }); // a phone that doesn't say
    expect(getThemeTransitionTier()).toBe('light');
  });

  it('never the reveal again after a slow one', () => {
    fakeViewTransitions();
    capablePhone();
    localStorage.setItem(STATE_KEY, JSON.stringify({ fast: 5, noReveal: true }));
    expect(getThemeTransitionTier()).toBe('light');
  });

  it('is instant with reduced motion', () => {
    window.matchMedia = (q) => ({ matches: q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} });
    expect(getThemeTransitionTier()).toBe('instant');
  });

  it('can be forced for device testing with ?themeTier=', () => {
    window.history.replaceState(null, '', '/?themeTier=full');
    expect(getThemeTransitionTier()).toBe('full');
    window.history.replaceState(null, '', '/?themeTier=instant');
    expect(getThemeTransitionTier()).toBe('instant');
  });
});

describe('the cover', () => {
  it('fades in first, swaps the theme once underneath, then lifts', async () => {
    let finishIn;
    const fades = [];
    HTMLElement.prototype.animate = function (frames) {
      fades.push(frames[1].opacity);
      return { finished: fades.length === 1 ? new Promise((r) => { finishIn = r; }) : Promise.resolve() };
    };
    const done = toggleTheme();
    expect(cover()).toBeTruthy();
    expect(cover().style.background).toBeTruthy();
    expect(root.dataset.theme).toBe('light'); // not yet: the cover is still fading in
    finishIn();
    await done;
    delete HTMLElement.prototype.animate;
    expect(fades).toEqual([1, 0]);
    expect(root.dataset.theme).toBe('dark');
    expect(themeWrites).toEqual(['dark']); // exactly once
    expect(cover()).toBeNull();
  });

  it('turns element transitions off in the same step as the theme, and back on before it lifts', async () => {
    let classAtApply = null;
    const watch = new MutationObserver(() => { classAtApply ??= root.classList.contains('theme-switching'); });
    watch.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const fades = [];
    HTMLElement.prototype.animate = function (frames) {
      fades.push([frames[1].opacity, root.classList.contains('theme-switching')]);
      return { finished: Promise.resolve() };
    };
    await toggleTheme();
    delete HTMLElement.prototype.animate;
    watch.disconnect();
    expect(classAtApply).toBe(true);
    expect(fades).toEqual([[1, false], [0, false]]); // the UI revealed is the final one
    expect(root.classList.contains('theme-switching')).toBe(false);
  });

  it('keeps transitions off for the whole reveal, and on again after it', async () => {
    const calls = fakeViewTransitions();
    window.history.replaceState(null, '', '/?themeTier=full');
    const done = toggleTheme();
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await calls[0].ready;
    await new Promise((r) => setTimeout(r, 20));
    expect(root.classList.contains('theme-switching')).toBe(true);
    calls[0].finish();
    await done;
    expect(root.classList.contains('theme-switching')).toBe(false);
  });

  it('switches a change nobody animated (the phone going dark) without transitions too', async () => {
    let dark = false;
    window.matchMedia = (q) => ({ matches: q.includes('dark') && dark, addEventListener() {}, removeEventListener() {} });
    __resetTheme();
    localStorage.setItem('locus.theme', 'system');
    installTheme();
    dark = true;
    let classAtApply = null;
    const watch = new MutationObserver(() => { classAtApply ??= root.classList.contains('theme-switching'); });
    watch.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve(); // observers report in a microtask
    watch.disconnect();
    expect(root.dataset.theme).toBe('dark');
    expect(classAtApply).toBe(true);
    await vi.waitFor(() => expect(root.classList.contains('theme-switching')).toBe(false));
  });

  it('waits briefly for the map under the cover, so a quick map needs no veil', async () => {
    const map = document.createElement('div');
    document.body.appendChild(map);
    registerThemeSettle(() => ({ ready: new Promise((r) => setTimeout(r, 30)), veil: map }));
    await toggleTheme();
    expect(root.dataset.theme).toBe('dark');
    expect(map.querySelector('[data-theme-veil]')).toBeNull();
    expect(cover()).toBeNull();
  });

  it('veils a slow map in the new theme until its tiles are in, then lifts the veil', async () => {
    const map = document.createElement('div');
    document.body.appendChild(map);
    let redrawn;
    registerThemeSettle(() => ({ ready: new Promise((r) => { redrawn = r; }), veil: map }));
    await toggleTheme();
    expect(cover()).toBeNull(); // the rest of the app is already showing
    const veil = map.querySelector('[data-theme-veil]');
    expect(veil).toBeTruthy();
    expect(veil.style.pointerEvents).toBe('none');
    redrawn();
    await vi.waitFor(() => expect(map.querySelector('[data-theme-veil]')).toBeNull());
  });

  it('never leaves a veil up past its cap', async () => {
    const map = document.createElement('div');
    document.body.appendChild(map);
    registerThemeSettle(() => ({ ready: new Promise(() => {}), veil: map }));
    await toggleTheme();
    expect(map.querySelector('[data-theme-veil]')).toBeTruthy();
    await vi.waitFor(() => expect(map.querySelector('[data-theme-veil]')).toBeNull(), { timeout: 4500 });
  }, 8000);

  it('tells preparers the new theme when the switch starts, before the theme is swapped', async () => {
    const seen = [];
    registerThemePrepare((theme) => seen.push({ theme, appliedYet: root.dataset.theme }));
    await toggleTheme();
    expect(seen).toEqual([{ theme: 'dark', appliedYet: 'light' }]);
  });

  it('veils nothing a settler says has nothing to redraw', async () => {
    registerThemeSettle(() => null);
    await toggleTheme();
    expect(document.querySelector('[data-theme-veil]')).toBeNull();
    expect(root.dataset.theme).toBe('dark');
  });

  it('is not used for a choice that changes nothing on screen', async () => {
    await switchThemePreference('light');
    expect(cover()).toBeNull();
    expect(themeWrites).toEqual([]);
  });
});

describe('taps while a switch runs', () => {
  it('end on the theme the last tap asked for, with nothing left behind', async () => {
    const first = toggleTheme(); // to dark
    toggleTheme(); // back to light
    toggleTheme(); // and dark again
    await first;
    await vi.waitFor(() => expect(cover()).toBeNull());
    await new Promise((r) => setTimeout(r, 400));
    expect(root.dataset.theme).toBe('dark');
    expect(localStorage.getItem('locus.theme')).toBe('dark');
    expect(document.querySelectorAll('[data-theme-cover]').length).toBe(0);
    expect(root.classList.contains('theme-switching')).toBe(false);
  });

  it('go back when the second tap undoes the first', async () => {
    const first = toggleTheme();
    toggleTheme();
    await first;
    await vi.waitFor(() => expect(root.dataset.theme).toBe('light'));
    await vi.waitFor(() => expect(cover()).toBeNull());
    expect(root.classList.contains('theme-switching')).toBe(false);
  });
});

describe('when something fails', () => {
  it('a throwing map hook still ends on the new theme with the cover gone', async () => {
    registerThemeSettle(() => { throw new Error('map gone'); });
    await toggleTheme();
    expect(root.dataset.theme).toBe('dark');
    expect(cover()).toBeNull();
    expect(root.classList.contains('theme-switching')).toBe(false);
  });

  it('a reveal that fails still applies the choice and cleans up', async () => {
    window.history.replaceState(null, '', '/?themeTier=full');
    document.startViewTransition = () => { throw new Error('no transition'); };
    await toggleTheme();
    expect(root.dataset.theme).toBe('dark');
    expect(root.classList.contains('theme-switching')).toBe(false);
  });
});

describe('what a switch teaches about the phone', () => {
  it('counts fast covered swaps, and two make a capable phone eligible for the reveal', async () => {
    fakeViewTransitions();
    capablePhone();
    await toggleTheme();
    expect(state().fast).toBe(1);
    await toggleTheme();
    expect(state().fast).toBe(2);
    expect(getThemeTransitionTier()).toBe('full');
  });

  it('a stutter while the cover fades starts the count again, but never makes it instant', async () => {
    // Each fade takes three frames, each frame longer than the limit.
    HTMLElement.prototype.animate = () => ({
      finished: new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))),
    });
    frameMs = THEME_SLOW_APPLY_MS + 20;
    await toggleTheme();
    delete HTMLElement.prototype.animate;
    expect(state().fast).toBe(0);
    expect(getThemeTransitionTier()).toBe('light');
  });

  it('a reveal veils the map instead of freezing the screen to wait for it', async () => {
    const calls = fakeViewTransitions();
    capablePhone();
    localStorage.setItem(STATE_KEY, JSON.stringify({ fast: 2 }));
    const map = document.createElement('div');
    document.body.appendChild(map);
    let redrawn;
    registerThemeSettle(() => ({ ready: new Promise((r) => { redrawn = r; }), veil: map }));
    const done = toggleTheme(document.body);
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await calls[0].updateCallbackDone; // returned at once, map not redrawn yet
    expect(root.dataset.theme).toBe('dark');
    expect(map.querySelector('[data-theme-veil]')).toBeTruthy();
    calls[0].finish();
    await done;
    expect(root.animate).toHaveBeenCalledWith(
      expect.objectContaining({ clipPath: expect.any(Array) }),
      expect.objectContaining({ pseudoElement: '::view-transition-new(root)' }),
    );
    expect(state().noReveal).toBeUndefined();
    redrawn();
    await vi.waitFor(() => expect(map.querySelector('[data-theme-veil]')).toBeNull());
  });

  it('a reveal that froze the screen too long is never offered again', async () => {
    const calls = fakeViewTransitions();
    capablePhone();
    localStorage.setItem(STATE_KEY, JSON.stringify({ fast: 2 }));
    const real = document.startViewTransition;
    document.startViewTransition = (update) => {
      const call = real(update);
      call.ready = new Promise((r) => setTimeout(r, THEME_SLOW_APPLY_MS + 60));
      return call;
    };
    const done = toggleTheme();
    await vi.waitFor(() => expect(calls.length).toBe(1));
    calls[0].finish();
    await done;
    expect(root.dataset.theme).toBe('dark');
    expect(state().noReveal).toBe(true);
    expect(getThemeTransitionTier()).toBe('light');
  });
});

describe('the status bar', () => {
  it('follows each theme change once, on a phone', async () => {
    native.isNative = true;
    await toggleTheme();
    expect(native.setStyle).toHaveBeenCalledTimes(1);
    expect(native.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });
    await toggleTheme();
    expect(native.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
    expect(native.setStyle).toHaveBeenCalledTimes(2);
  });
});

describe('index.css', () => {
  const css = readFileSync(fileURLToPath(new globalThis.URL('../src/index.css', import.meta.url)), 'utf8');

  it('keeps the browser cross-fade off for the whole reveal, not only while a class is set', () => {
    // Scoped to a class that the reveal removed before the transition ended, the default
    // cross-fade came back mid-transition and the old theme flashed back on screen.
    expect(css).toMatch(/(^|\n)::view-transition-old\(root\),\s*\n::view-transition-new\(root\)\s*\{[^}]*animation:\s*none/);
    expect(css).not.toMatch(/\S+::view-transition-(old|new)\(root\)/);
  });

  it('turns element transitions off while the theme is swapped', () => {
    expect(css).toMatch(/html\.theme-switching \*,[^{]*\{[^}]*transition:\s*none !important/);
  });

  it('has no other theme fade left', () => {
    expect(css).not.toMatch(/theme-transitioning|view-transition-active/);
    expect(css).not.toMatch(/transition:\s*filter/);
  });
});
