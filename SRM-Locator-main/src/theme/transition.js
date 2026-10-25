import { flushSync } from 'react-dom';
import { setThemePreference, getThemePreference, resolveTheme, systemPrefersDark } from './theme';

let running = false;

// Keep the existing theme store, system preference, and native subscribers in sync.
export async function transitionTheme(preference, origin = null) {
  if (running) return;
  const apply = () => flushSync(() => setThemePreference(preference));
  const next = resolveTheme(preference, systemPrefersDark());
  const current = resolveTheme(getThemePreference(), systemPrefersDark());
  if (next === current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      typeof document.startViewTransition !== 'function' ||
      typeof document.documentElement.animate !== 'function') {
    apply();
    return;
  }
  running = true;
  let applied = false;
  const update = () => { apply(); applied = true; };
  try {
    const transition = document.startViewTransition(update);
    // Observe finished immediately, including when a hidden document skips the transition.
    const finished = transition.finished.catch(() => {});
    try {
      await transition.ready;
      const rect = origin?.getBoundingClientRect?.();
      const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      const radius = Math.hypot(
        Math.max(centerX, window.innerWidth - centerX),
        Math.max(centerY, window.innerHeight - centerY),
      );
      document.documentElement.animate({
        clipPath: [
          `circle(0px at ${centerX}px ${centerY}px)`,
          `circle(${radius}px at ${centerX}px ${centerY}px)`,
        ],
      }, { duration: 700, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' });
    } catch {
      transition.skipTransition();
    }
    await finished;
  } catch {
    if (!applied) update();
  } finally {
    running = false;
  }
}
