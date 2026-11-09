import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useResolvedTheme } from '../../theme/useResolvedTheme';
import { transitionTheme } from '../../theme/transition';

export function AnimatedThemeToggleButton({ className = '' }) {
  const theme = useResolvedTheme();
  const darkMode = theme === 'dark';
  const label = darkMode ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" onClick={() => transitionTheme(darkMode ? 'light' : 'dark')}
      aria-label={label} title={label} data-theme-toggle={theme}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-accent-soft text-accent shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent cursor-pointer ${className}`}
      style={{ width: 44, height: 44 }}>
      {darkMode ? <Moon size={22} aria-hidden="true" /> : <Sun size={22} aria-hidden="true" />}
    </button>
  );
}
