import { useEffect, useState } from 'react';
import { getThemePreference, resolveTheme, subscribeTheme, systemPrefersDark } from './theme';

/**
 * The theme on screen now, 'light' or 'dark', for the few things that can't follow the CSS
 * variables by themselves (the Google map's style array). Re-renders when it changes.
 */
export function useResolvedTheme() {
  const [theme, setTheme] = useState(() => resolveTheme(getThemePreference(), systemPrefersDark()));
  useEffect(() => subscribeTheme((current) => setTheme(current.theme)), []);
  return theme;
}
