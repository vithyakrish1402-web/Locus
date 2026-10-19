// Light and dark theme (redesign item 2): the person's choice, System / Light / Dark, kept
// on this phone; System, the default, follows the phone's own setting.
//
// What it does is set `data-theme="light" | "dark"` on <html>, which src/theme/tokens.css
// keys off. The first time is before React exists: the inline script in index.html does the
// same job before first paint, so the wrong theme never flashes on screen. That script
// cannot import this module, so it repeats resolveTheme in a few lines; the
// themePrePaint test runs it against this file to keep the two the same.
//
// Kept in localStorage, a per-device convenience: it survives restarts and live updates
// (the WebView's origin stays the same) and is never sent anywhere. Storage can be missing
// or throw (blocked, private mode); then the choice is simply System.

import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export const THEME_STORAGE_KEY = 'locus.theme';
export const THEME_PREFERENCES = ['system', 'light', 'dark'];
export const DEFAULT_THEME_PREFERENCE = 'system';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

// A choice that couldn't be saved (storage blocked or full) still holds for this session.
let unsaved = null;

/** The saved choice, or 'system' when there is none (or it can't be read). */
export function getThemePreference() {
  if (unsaved) return unsaved;
  try {
    const saved = storage()?.getItem(THEME_STORAGE_KEY);
    return THEME_PREFERENCES.includes(saved) ? saved : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Whether the phone itself is set to dark. False where that can't be asked. */
export function systemPrefersDark() {
  try {
    return Boolean(window.matchMedia?.(DARK_QUERY).matches);
  } catch {
    return false;
  }
}

/**
 * The theme to show for a choice.
 * @param {'system'|'light'|'dark'} preference
 * @param {boolean} prefersDark the phone's own setting
 * @returns {'light'|'dark'}
 */
export function resolveTheme(preference, prefersDark) {
  if (preference === 'light' || preference === 'dark') return preference;
  return prefersDark ? 'dark' : 'light';
}

/** Puts `theme` on <html>, where the tokens read it. Writes nothing when it is already there. */
export function applyTheme(theme, root = document.documentElement) {
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  if (root.classList.contains('dark') !== (theme === 'dark')) root.classList.toggle('dark', theme === 'dark');
}

/**
 * The phone's status bar icons, for the theme on screen: light icons on the dark theme,
 * dark on the light. The app draws under the bar (edge-to-edge), so only the icons need
 * setting. A shell without the plugin rejects the call; nothing depends on it.
 */
export function syncStatusBar(theme = current?.theme) {
  try {
    if (!theme || !Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
  } catch {
    // no native bridge
  }
}

const listeners = new Set();
let current = null; // { preference, theme }

function update() {
  const preference = getThemePreference();
  const theme = resolveTheme(preference, systemPrefersDark());
  const changed = !current || current.preference !== preference || current.theme !== theme;
  const themeChanged = !current || current.theme !== theme;
  // Every change lands in one frame: no element fades its own colours across (they would
  // show half-way colours under a reveal, or as the cover lifts). A switch has already set
  // the class (swapTo); any other change (the phone's own dark mode) gets it for two frames.
  if (themeChanged && current && !switching) suppressTransitionsBriefly();
  applyTheme(theme);
  if (themeChanged) {
    syncStatusBar(theme);
    debugEvent('apply', theme);
  }
  current = { preference, theme };
  if (changed) listeners.forEach((fn) => fn(current));
}

/**
 * Saves a choice and shows it at once.
 * @param {'system'|'light'|'dark'} preference
 */
export function setThemePreference(preference) {
  if (!THEME_PREFERENCES.includes(preference)) return;
  try {
    storage().setItem(THEME_STORAGE_KEY, preference);
    unsaved = null;
  } catch {
    unsaved = preference;
  }
  update();
}

/** Calls `fn({ preference, theme })` now and on every change. Returns an unsubscribe. */
export function subscribeTheme(fn) {
  listeners.add(fn);
  if (current) fn(current);
  return () => listeners.delete(fn);
}

/**
 * Starts theming: applies the saved choice (index.html normally did already) and, while
 * the choice is System, follows the phone switching between light and dark. Returns a
 * function that stops following.
 */
export function installTheme() {
  update();
  let media = null;
  try {
    media = window.matchMedia?.(DARK_QUERY) ?? null;
  } catch {
    media = null;
  }
  // Re-read on each change rather than checking the choice here: update() resolves it, and
  // a Light or Dark choice ignores the phone anyway.
  const onChange = () => update();
  media?.addEventListener?.('change', onChange);
  // And whenever the app comes back to the front. Android doesn't restart LOCUS when the
  // phone switches dark mode (MainActivity handles uiMode itself), so the WebView's change
  // event is the only signal while it runs; this covers a phone that doesn't send it, for
  // the usual case of switching in Settings and coming back.
  const onVisible = () => { if (document.visibilityState === 'visible') update(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    media?.removeEventListener?.('change', onChange);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

// ------------------------------------------------------------------ switching themes
//
// A switch the person asks for (the Group panel's button, Settings) runs exactly one
// effect, picked per phone by getThemeTransitionTier():
//
//   'light'   the default. A cover in the new theme's background fades in (opacity only, so
//             the compositor runs it), the theme is swapped underneath while the cover hides
//             everything, the cover waits for the Google map to redraw in the new style,
//             then fades out. No screen capture and no clip-path: it cannot show a
//             half-themed frame.
//   'full'    the circular reveal from the button (View Transitions). Only on a phone with
//             the API, THEME_MIN_CORES_FOR_FULL cores and THEME_MIN_MEMORY_GB_FOR_FULL GB
//             that has also been fast on its own last THEME_FAST_SWITCHES_FOR_FULL
//             switches. One slow reveal and that phone never gets it again.
//   'instant' reduced motion, or a phone on which the cover's fade ever stuttered.
//
// Why the cover is the default (js-1.1.54 in Chromium at 6x CPU throttle, a weak-phone
// stand-in): the reveal froze the screen ~180 ms before anything moved, because the whole
// App re-rendered inside the transition's update; the Google map then restyled its tiles in
// patches inside the already-revealed new theme; and the reveal's CSS switched the
// browser's own cross-fade back on before the transition ended, so the old theme snapped
// back for two frames. The cover hides all of that by construction.

/** For device testing: 'full' | 'light' | 'instant' forces that effect (so does ?themeTier=). null picks per phone. */
export const THEME_TRANSITION_FORCE_TIER = null;
/** The cover's fade, in and out, each. 150-200 ms reads as one quick blink. */
export const THEME_FALLBACK_OVERLAY_MS = 180;
/**
 * A frame longer than this (five 60 Hz frames) is a stutter. It is the most the theme swap
 * may hold the main thread for a phone to count as fast enough for the circular reveal, and
 * the longest frame the visible part of a switch may take before the phone is moved down.
 */
export const THEME_SLOW_APPLY_MS = 80;
/** The circular reveal is only considered with at least this many cores... */
export const THEME_MIN_CORES_FOR_FULL = 6;
/** ...and this much memory (navigator.deviceMemory; a phone that doesn't say never qualifies). */
export const THEME_MIN_MEMORY_GB_FOR_FULL = 4;
/**
 * Timing log for each switch: console, window.__themeDebugLog and a small readout on screen.
 * Also on with ?themeDebug=1, localStorage `locus.themeDebug` = '1', or VITE_THEME_DEBUG=1
 * at build time (a phone build without code changes). Off in every normal build.
 */
export const THEME_DEBUG = false;

const TIERS = ['full', 'light', 'instant'];
// On <html> while the theme is swapped: no element fades its colours across on its own and
// CSS animations hold still (index.css). Set in the same style pass as the new theme.
// Measured cheaper than letting the transitions start and finishing them
// (document.getAnimations): in Settings at 6x, 255 + 238 ms (the class's two restyles,
// both out of sight) against 610 ms, as hundreds of transitions were created and ended.
const SWITCHING_CLASS = 'theme-switching';
// What each phone has shown so far: { fast, noReveal }. Per-device, like the choice.
const TRANSITION_STATE_KEY = 'locus.themeTransition';
// How long the cover waits for the map to redraw. Past that the cover lifts and the map
// alone stays veiled in the new theme's land colour until its tiles are in (first tiles of
// a style can take seconds on a slow phone or network).
const THEME_COVER_WAIT_MS = 250;
const THEME_MAP_VEIL_MAX_MS = 3000;
const THEME_REVEAL_MS = 450;
const THEME_FAST_SWITCHES_FOR_FULL = 2;
// Whatever happens, no cover or switching class outlives this.
const THEME_SWITCH_GUARD_MS = 4000;

let switching = null; // the running switch
let switchingTo = null; // the theme it is heading to
let queued = null; // a choice made while one runs, switched to next
const settlers = new Set();
const veils = new Set();

/**
 * Things that redraw in the new theme on their own time (the Google map's tiles). `fn` is
 * called when the theme is swapped and returns `{ ready, veil }`: a promise that settles once
 * it has redrawn, and the element it draws in. The cover waits for `ready` briefly
 * (THEME_COVER_WAIT_MS); if it isn't by then, `veil` is covered in the new theme's map land
 * colour until it is (capped), so it never shows the old theme. Returns an unregister.
 */
export function registerThemeSettle(fn) {
  settlers.add(fn);
  return () => settlers.delete(fn);
}

const within = (promise, ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  Promise.resolve(promise).then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
});

// rAF never fires while the app is in the background, so every wait on it is capped.
const nextFrames = (count = 2) => within(new Promise((resolve) => {
  if (typeof requestAnimationFrame !== 'function') { resolve(); return; }
  const step = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(count);
}), 300);

// Asks each settler to start waiting; call right after the theme is swapped.
function startSettling() {
  return [...settlers].map((fn) => {
    let result = null;
    try { result = fn(); } catch { result = null; }
    const wait = { done: false, veil: result?.veil ?? null };
    wait.ready = Promise.resolve(result?.ready).catch(() => null).then(() => { wait.done = true; });
    return wait;
  });
}

// 'none' (nothing to wait for), 'settled', or 'cap' (still redrawing after maxMs).
function waitForSettle(waits, maxMs) {
  if (!waits.length) return Promise.resolve('none');
  return within(Promise.all(waits.map((w) => w.ready)), maxMs).then(() => (waits.every((w) => w.done) ? 'settled' : 'cap'));
}

function clearVeils() {
  veils.forEach((veil) => veil.remove());
  veils.clear();
}

// Veils whatever hasn't redrawn yet, and lifts each veil once its own redraw is in.
function veilUnsettled(waits, fade) {
  const land = getComputedStyle(document.documentElement).getPropertyValue('--color-map-land').trim()
    || themeBackground(current?.theme);
  waits.filter((w) => !w.done && w.veil?.appendChild).forEach((w) => {
    const veil = document.createElement('div');
    veil.setAttribute('aria-hidden', 'true');
    veil.dataset.themeVeil = '';
    veil.style.cssText = `position:absolute;inset:0;z-index:2147483000;pointer-events:none;background:${land};will-change:opacity;`;
    w.veil.appendChild(veil);
    veils.add(veil);
    debugEvent('map-veiled');
    within(w.ready.then(() => nextFrames(2)), THEME_MAP_VEIL_MAX_MS).then(async () => {
      if (!veils.has(veil)) return;
      if (fade) await fadeCover(veil, 1, 0, 'ease-out');
      veil.remove();
      veils.delete(veil);
      debugEvent('map-unveiled', w.done ? 'tiles' : 'cap');
    });
  });
}

// Frame gaps from requestAnimationFrame while a phase runs. Returns a stop function that
// gives { max, long } (the longest gap, and how many were over THEME_SLOW_APPLY_MS).
function watchFrames() {
  let last = null;
  let max = 0;
  let long = 0;
  let running = typeof requestAnimationFrame === 'function';
  const tick = (now) => {
    if (!running) return;
    if (last !== null) {
      const gap = now - last;
      if (gap > max) max = gap;
      if (gap > THEME_SLOW_APPLY_MS) long += 1;
    }
    last = now;
    requestAnimationFrame(tick);
  };
  if (running) requestAnimationFrame(tick);
  return () => { running = false; return { max: Math.round(max), long }; };
}

function readTransitionState() {
  try {
    const saved = JSON.parse(storage()?.getItem(TRANSITION_STATE_KEY) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function writeTransitionState(state) {
  try {
    storage()?.setItem(TRANSITION_STATE_KEY, JSON.stringify(state));
  } catch {
    // not kept: the next launch measures again
  }
}

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function forcedTier() {
  if (TIERS.includes(THEME_TRANSITION_FORCE_TIER)) return THEME_TRANSITION_FORCE_TIER;
  try {
    const asked = new URLSearchParams(window.location.search).get('themeTier');
    if (TIERS.includes(asked)) return asked;
  } catch {
    // no URL to ask
  }
  return null;
}

/** Whether this phone has what the circular reveal needs at all (not whether it is fast). */
export function canRunFullReveal(env = globalThis) {
  const nav = env.navigator || {};
  return typeof env.document?.startViewTransition === 'function'
    && (nav.hardwareConcurrency || 0) >= THEME_MIN_CORES_FOR_FULL
    && (nav.deviceMemory || 0) >= THEME_MIN_MEMORY_GB_FOR_FULL;
}

/** The effect the next switch uses on this phone: 'full' | 'light' | 'instant'. */
export function getThemeTransitionTier() {
  const forced = forcedTier();
  if (forced) return forced;
  if (prefersReducedMotion()) return 'instant';
  const state = readTransitionState();
  if (!state.noReveal && (state.fast || 0) >= THEME_FAST_SWITCHES_FOR_FULL && canRunFullReveal()) return 'full';
  return 'light';
}

// What a switch showed about this phone, kept for the next ones.
function recordSwitch(tier, m) {
  const state = readTransitionState();
  if (tier === 'light') {
    // The phone's own work under the cover (how fast the map's tiles arrive is the
    // network's). The cover's fade itself never moves a phone down: it is an opacity
    // animation the compositor runs, which main-thread hiccups (measured: Google Maps' own
    // tasks) don't stutter, and an instant switch would show a slow phone's freeze.
    state.fast = m.applyMs <= THEME_SLOW_APPLY_MS && m.visibleMaxFrameMs <= THEME_SLOW_APPLY_MS ? (state.fast || 0) + 1 : 0;
  } else if (tier === 'full') {
    if (m.applyMs > THEME_SLOW_APPLY_MS || m.visibleMaxFrameMs > THEME_SLOW_APPLY_MS) {
      state.noReveal = true;
      state.fast = 0;
    }
  }
  writeTransitionState(state);
}

// The theme's page background, from the stylesheet (tokens.css: `:root` for light,
// `:root[data-theme="dark"]` for dark), so the cover is exactly the colour it gives way to.
const backgrounds = {};
function themeBackground(theme) {
  if (backgrounds[theme]) return backgrounds[theme];
  const selector = theme === 'dark' ? ':root[data-theme="dark"]' : ':root';
  let found = null;
  const walk = (rules) => {
    for (const rule of rules) {
      if (found) return;
      if (rule.selectorText === selector) found = rule.style?.getPropertyValue('--color-bg')?.trim() || null;
      else if (rule.cssRules) {
        try { walk(rule.cssRules); } catch { /* unreadable */ }
      }
    }
  };
  try {
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* another origin's sheet */ }
    }
  } catch {
    // no stylesheets to read
  }
  backgrounds[theme] = found || (theme === 'dark' ? '#0E1116' : '#F4F6F8');
  return backgrounds[theme];
}

function createCover(theme) {
  const cover = document.createElement('div');
  cover.setAttribute('aria-hidden', 'true');
  cover.dataset.themeCover = theme;
  // Above everything (Settings, sheets, SOS), and it takes the taps meant for the hidden UI.
  cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:auto;'
    + `background:${themeBackground(theme)};opacity:0;will-change:opacity;contain:strict;`;
  document.body.appendChild(cover);
  return cover;
}

function fadeCover(cover, from, to, easing) {
  const settle = () => { cover.style.opacity = String(to); };
  if (typeof cover.animate !== 'function') { settle(); return Promise.resolve(); }
  const animation = cover.animate([{ opacity: from }, { opacity: to }], { duration: THEME_FALLBACK_OVERLAY_MS, easing, fill: 'forwards' });
  return within(animation.finished, THEME_FALLBACK_OVERLAY_MS + 400).then(settle);
}

// The one place a switch changes the theme: the switching class and the new theme land in
// the same style pass.
function swapTo(preference) {
  clearVeils();
  document.documentElement.classList.add(SWITCHING_CLASS);
  setThemePreference(preference);
}

function suppressTransitionsBriefly() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.add(SWITCHING_CLASS);
  nextFrames(2).then(() => { if (!switching) root.classList.remove(SWITCHING_CLASS); });
}

async function coverSwap(preference, cover, m) {
  let stop = watchFrames();
  await fadeCover(cover, 0, 1, 'cubic-bezier(0.4, 0, 1, 1)');
  const fadeIn = stop();
  debugEvent('covered');

  stop = watchFrames();
  swapTo(preference);
  const waits = startSettling();
  m.settle = await waitForSettle(waits, THEME_COVER_WAIT_MS);
  debugEvent('settled', m.settle);
  veilUnsettled(waits, true);
  await nextFrames(2);
  // Removing the class restyles everything once more; still under the cover.
  document.documentElement.classList.remove(SWITCHING_CLASS);
  await nextFrames(2);
  const covered = stop();
  m.applyMs = covered.max;
  debugEvent('restored');

  stop = watchFrames();
  await fadeCover(cover, 1, 0, 'cubic-bezier(0, 0, 0.2, 1)');
  const fadeOut = stop();
  m.visibleMaxFrameMs = Math.max(fadeIn.max, fadeOut.max);
  m.longFrames = fadeIn.long + fadeOut.long;
  m.phases = { fadeIn, covered, fadeOut };
}

async function reveal(preference, origin, m) {
  const rect = origin?.getBoundingClientRect?.();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const started = performance.now();
  const transition = document.startViewTransition(() => {
    swapTo(preference);
    // No waiting in here: the screen is frozen until this returns. The map is veiled in
    // the new theme instead and shows its tiles when they are in.
    const waits = startSettling();
    m.settle = waits.length ? 'veiled' : 'none';
    veilUnsettled(waits, true);
  });
  await transition.ready;
  // The screen was frozen from the tap until now: all of it is the phone's own work.
  m.applyMs = Math.round(performance.now() - started);
  debugEvent('revealing');
  const stop = watchFrames();
  document.documentElement.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    { duration: THEME_REVEAL_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
  );
  await within(transition.finished, THEME_REVEAL_MS + 1500);
  // The switching class comes off once the transition is over (runSwitch), when its
  // restyle changes nothing on screen.
  const frames = stop();
  m.visibleMaxFrameMs = frames.max;
  m.longFrames = frames.long;
}

async function runSwitch(preference, toTheme, origin, tier) {
  const m = { tier, to: toTheme, applyMs: 0, visibleMaxFrameMs: 0, longFrames: 0, settle: 'none' };
  const session = debugBegin(m);
  let cover = null;
  let wentHidden = false;
  const onVisibility = () => { if (document.visibilityState === 'hidden') wentHidden = true; };
  document.addEventListener('visibilitychange', onVisibility);
  const cleanUp = () => {
    cover?.remove();
    cover = null;
    document.documentElement.classList.remove(SWITCHING_CLASS);
  };
  const guard = setTimeout(cleanUp, THEME_SWITCH_GUARD_MS);
  try {
    if (tier === 'full') {
      await reveal(preference, origin, m);
    } else if (tier === 'light') {
      cover = createCover(toTheme);
      await coverSwap(preference, cover, m);
    } else {
      swapTo(preference);
      veilUnsettled(startSettling(), false);
      await nextFrames(2);
    }
  } catch (error) {
    m.error = String(error?.message || error);
  } finally {
    clearTimeout(guard);
    document.removeEventListener('visibilitychange', onVisibility);
    // Whatever went wrong, the choice ends up on screen and nothing is left half-done.
    if (current?.preference !== preference) setThemePreference(preference);
    cleanUp();
  }
  // A switch that ran partly in the background (or was forced for a test) says nothing
  // about this phone.
  if (!wentHidden && !m.error && !forcedTier()) recordSwitch(tier, m);
  debugEnd(session, m);
}

/**
 * Saves a choice and switches to it with this phone's effect (getThemeTransitionTier).
 * `origin`, the control that was pressed, is where the circular reveal starts. A choice made
 * while a switch runs is switched to right after it. Resolves once the screen is settled.
 * @param {'system'|'light'|'dark'} preference
 * @param {Element|null} [origin]
 */
export function switchThemePreference(preference, origin = null) {
  if (!THEME_PREFERENCES.includes(preference)) return Promise.resolve();
  if (switching) {
    queued = preference;
    return switching;
  }
  const prefersDark = systemPrefersDark();
  const from = current?.theme ?? resolveTheme(getThemePreference(), prefersDark);
  const to = resolveTheme(preference, prefersDark);
  if (from === to || typeof document === 'undefined' || document.visibilityState === 'hidden') {
    setThemePreference(preference);
    return Promise.resolve();
  }
  let tier = getThemeTransitionTier();
  if (tier === 'full' && typeof document.startViewTransition !== 'function') tier = 'light';
  switchingTo = to;
  switching = runSwitch(preference, to, origin, tier).finally(() => {
    switching = null;
    switchingTo = null;
    const next = queued;
    queued = null;
    if (next !== null && next !== (current?.preference ?? getThemePreference())) return switchThemePreference(next, null);
    return undefined;
  });
  return switching;
}

/** The light/dark button: switches to the other theme from the one the screen is heading to. */
export function toggleTheme(origin = null) {
  const heading = queued !== null
    ? resolveTheme(queued, systemPrefersDark())
    : switchingTo ?? current?.theme ?? resolveTheme(getThemePreference(), systemPrefersDark());
  return switchThemePreference(heading === 'dark' ? 'light' : 'dark', origin);
}

// ------------------------------------------------------------------ debug timings

let debugSession = null;
let debugCount = 0;

function themeDebugOn() {
  if (THEME_DEBUG) return true;
  try {
    if (import.meta.env.VITE_THEME_DEBUG === '1') return true;
  } catch {
    // no build env
  }
  try {
    if (new URLSearchParams(window.location.search).get('themeDebug') === '1') return true;
  } catch {
    // no URL
  }
  try {
    return storage()?.getItem('locus.themeDebug') === '1';
  } catch {
    return false;
  }
}

function debugBegin(m) {
  if (!themeDebugOn() || typeof performance === 'undefined') return null;
  debugSession = { t0: performance.now(), events: [], applies: 0 };
  debugEvent('tap', `${m.tier} -> ${m.to}`);
  return debugSession;
}

function debugEvent(name, detail) {
  if (!debugSession) return;
  if (name === 'apply') debugSession.applies += 1;
  const at = Math.round(performance.now() - debugSession.t0);
  debugSession.events.push(detail === undefined ? `${name} ${at}` : `${name}(${detail}) ${at}`);
}

function debugEnd(session, m) {
  if (!session) return;
  debugEvent('done');
  const summary = {
    n: ++debugCount,
    ...m,
    totalMs: Math.round(performance.now() - session.t0),
    themeApplies: session.applies,
    events: session.events.slice(),
    state: readTransitionState(),
    nextTier: getThemeTransitionTier(),
    cores: globalThis.navigator?.hardwareConcurrency ?? null,
    memoryGB: globalThis.navigator?.deviceMemory ?? null,
    viewTransitions: typeof document.startViewTransition === 'function',
  };
  // Keep counting for a second (a theme applied again after 'done' would be a late flicker),
  // and until the map's veil, if any, has lifted.
  const ended = performance.now();
  const publish = () => {
    const waited = performance.now() - ended;
    if (waited < 1000 || (veils.size && waited < THEME_MAP_VEIL_MAX_MS + 500)) { setTimeout(publish, 250); return; }
    summary.lateApplies = session.applies - summary.themeApplies;
    summary.events = session.events.slice();
    if (debugSession === session) debugSession = null;
    try {
      (window.__themeDebugLog ||= []).push(summary);
      console.info('[theme-switch]', JSON.stringify(summary));
      showDebugReadout(summary);
    } catch {
      // nowhere to report
    }
  };
  setTimeout(publish, 250);
}

function showDebugReadout(s) {
  let el = document.getElementById('theme-debug-readout');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'theme-debug-readout';
    el.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top) + 72px);z-index:2147483646;'
      + 'margin:0;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,0.82);color:#fff;'
      + 'font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;pointer-events:none;';
    document.body.appendChild(el);
  }
  const p = s.phases;
  el.textContent = [
    `THEME SWITCH #${s.n}  ${s.tier} -> ${s.to}  total ${s.totalMs} ms${s.error ? `  ERROR ${s.error}` : ''}`,
    `swap held main thread ${s.applyMs} ms (limit ${THEME_SLOW_APPLY_MS})  map under cover: ${s.settle}`,
    `worst visible frame ${s.visibleMaxFrameMs} ms, ${s.longFrames} over ${THEME_SLOW_APPLY_MS} ms`,
    p ? `fade in ${p.fadeIn.max}/${p.fadeIn.long}  covered ${p.covered.max}/${p.covered.long}  fade out ${p.fadeOut.max}/${p.fadeOut.long}` : '',
    `theme applied ${s.themeApplies}x, again after done ${s.lateApplies}x`,
    `next: ${s.nextTier}  fast ${s.state.fast || 0}${s.state.noReveal ? '  no-reveal' : ''}`,
    `cores ${s.cores}  memory ${s.memoryGB} GB  view transitions ${s.viewTransitions ? 'yes' : 'no'}`,
    s.events.join(' · '),
  ].filter(Boolean).join('\n');
}

/** Tests only. */
export function __resetTheme() {
  listeners.clear();
  settlers.clear();
  clearVeils();
  unsaved = null;
  current = null;
  switching = null;
  switchingTo = null;
  queued = null;
  debugSession = null;
}
