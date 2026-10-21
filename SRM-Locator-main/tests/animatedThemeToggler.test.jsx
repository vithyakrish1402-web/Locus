// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { AnimatedThemeToggler } from '../src/components/ui/animated-theme-toggler';

afterEach(cleanup);

describe('AnimatedThemeToggler', () => {
  it('renders a button with switch theme label', () => {
    render(<AnimatedThemeToggler />);
    const btn = screen.getByRole('button', { name: /switch theme/i });
    expect(btn).toBeTruthy();
  });

  it('toggles dark mode class on documentElement when clicked', async () => {
    document.documentElement.classList.remove('dark');
    render(<AnimatedThemeToggler />);
    const btn = screen.getByRole('button', { name: /switch theme/i });
    fireEvent.click(btn);
    // Through the one theme switch (theme.js): its cover is up at once.
    expect(document.querySelector('[data-theme-cover]')).toBeTruthy();
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    fireEvent.click(btn);
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
  });
});
