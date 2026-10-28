import { setThemePreference } from './theme';

// Theme choice must never wait for a View Transition or an animation frame: Android
// can suspend both while a dialog is open or the app goes into the background.
// The store applies tokens, status-bar style and subscribers together; its existing
// brief transition suppression avoids hundreds of individual colour animations.
export function transitionTheme(preference) {
  setThemePreference(preference);
  return Promise.resolve();
}
