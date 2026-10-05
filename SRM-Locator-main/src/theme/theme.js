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

/** Puts `theme` on <html>, where the tokens read it. */
export function applyTheme(theme, root = document.documentElement) {
  root.dataset.theme = theme;
}

const listeners = new Set();
let current = null; // { preference, theme }

function update() {
  const preference = getThemePreference();
  const theme = resolveTheme(preference, systemPrefersDark());
  applyTheme(theme);
  const changed = !current || current.preference !== preference || current.theme !== theme;
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

/** Tests only. */
export function __resetTheme() {
  listeners.clear();
  unsaved = null;
  current = null;
}
