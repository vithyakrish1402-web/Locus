// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { AnimatedThemeToggler } from '../src/components/ui/animated-theme-toggler';
import { __resetTheme, installTheme, getThemePreference } from '../src/theme/theme';
import { transitionTheme } from '../src/theme/transition';

let stop;
beforeEach(() => {
  __resetTheme(); localStorage.clear();
  localStorage.setItem('locus.theme', 'light');
  stop = installTheme();
});
afterEach(() => { cleanup(); stop(); vi.restoreAllMocks(); delete document.startViewTransition; });

describe('theme control', () => {
  it('shows the current theme icon and labels the action, on every press', () => {
    render(<AnimatedThemeToggler />);
    for (let n = 0; n < 8; n++) {
      const dark = n % 2 === 1;
      const btn = screen.getByRole('button', { name: dark ? 'Switch to light mode' : 'Switch to dark mode' });
      expect(btn.querySelector(dark ? '.lucide-moon' : '.lucide-sun')).toBeTruthy();
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(document.documentElement.dataset.theme).toBe(dark ? 'light' : 'dark');
      expect(getThemePreference()).toBe(dark ? 'light' : 'dark');
    }
  });
  it('switches even if the WebView never finishes a view transition', async () => {
    document.startViewTransition = vi.fn(() => ({ ready: new Promise(() => {}), finished: new Promise(() => {}) }));
    await transitionTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await transitionTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(document.querySelector('[data-theme-cover]')).toBeNull();
  });
  it('applies the last Settings selection without dropping requests', async () => {
    await Promise.all([transitionTheme('dark'), transitionTheme('light'), transitionTheme('dark')]);
    expect(getThemePreference()).toBe('dark');
  });
});
