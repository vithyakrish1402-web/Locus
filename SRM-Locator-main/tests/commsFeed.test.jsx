// @vitest-environment jsdom
//
// The notifications' look (src/components/CommsFeed.jsx, redesign P4): each kind's colour,
// problems in amber rather than red, the title-and-message layout, and dismissing.
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import CommsFeed from '../src/components/CommsFeed.jsx';
import { notify, __resetNotifications } from '../src/utils/notify.js';

MotionGlobalConfig.skipAnimations = true;

beforeEach(() => { __resetNotifications(); });
afterEach(() => { cleanup(); __resetNotifications(); });

const card = (text) => screen.getByText(text).closest('[data-severity]');
const disc = (text) => card(text).querySelector('[aria-hidden="true"]');

describe('notifications', () => {
  it.each([
    ['success', 'bg-success-soft'],
    ['info', 'bg-accent-soft'],
    ['warning', 'bg-warning-soft'],
    ['error', 'bg-warning-soft'],
  ])('%s has its own colour', (severity, tint) => {
    render(<CommsFeed />);
    act(() => { notify[severity](`a ${severity} notice`); });
    expect(disc(`a ${severity} notice`).className).toContain(tint);
  });

  it('a problem is amber and announced, never red', () => {
    render(<CommsFeed />);
    act(() => { notify.error('The Group Lead removed you from this group.'); });
    const notice = card('The Group Lead removed you from this group.');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.outerHTML).not.toMatch(/danger|emergency|red-/);
  });

  it('a ping has the ping look', () => {
    render(<CommsFeed />);
    act(() => { notify.info('Aarav is pinging you', { kind: 'ping' }); });
    expect(disc('Aarav is pinging you').querySelector('.lucide-radio')).toBeTruthy();
  });

  it('shows the title in bold with the message under it', () => {
    render(<CommsFeed />);
    act(() => { notify.warning('Showing where they were last.', { title: 'Aarav lost connection' }); });
    expect(screen.getByText('Aarav lost connection').className).toContain('text-heading');
    expect(screen.getByText('Showing where they were last.').className).toContain('text-text-secondary');
  });

  it('drops the old tactical labels', () => {
    render(<CommsFeed />);
    act(() => { notify.info('Hello'); notify.error('Oops'); });
    expect(screen.getByTestId('comms-feed').textContent).not.toMatch(/SYS_NOTICE|SYS_ERROR|CAUTION|CONFIRMED/);
  });

  it('dismisses with its close button', async () => {
    render(<CommsFeed />);
    act(() => { notify.info('Hello'); });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    await waitFor(() => expect(screen.queryByText('Hello')).toBeNull());
  });
});
