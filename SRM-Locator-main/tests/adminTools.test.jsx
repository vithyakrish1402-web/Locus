// @vitest-environment jsdom
//
// The owner's admin tools (the path recorder) and the recording bar, in the new look (Stop 2
// leftovers). Their words are unchanged until the wording pass; these pin the look and the flow.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import AdminTools, { RecordingBar } from '../src/components/admin/AdminTools.jsx';

MotionGlobalConfig.skipAnimations = true;
afterEach(cleanup);

const OLD_LOOK = /danger|red-|bg-emergency|text-emergency|yellow-|zinc-|emerald-|bg-black|font-dot|shadow-\[0_0|animate-pulse|animate-ping|bg-dots/;

const show = (props = {}) => {
  const handlers = { onRecord: vi.fn(), onPublish: vi.fn(), onAbort: vi.fn(), onClose: vi.fn() };
  render(<AdminTools open email="owner@example.com" name="Owner" recording={false} points={0} {...handlers} {...props} />);
  return handlers;
};

describe('the admin tools', () => {
  it('a labelled dialog on the theme surface, with no red, no glow and no old tactical look', () => {
    show();
    expect(screen.getByRole('dialog', { name: 'ADMIN_OVERRIDE' }).className).toContain('bg-surface');
    expect(screen.getByTestId('admin-tools').outerHTML).not.toMatch(OLD_LOOK);
  });

  it('starts a recording, and closes from Close or CLOSE_TERMINAL', () => {
    const h = show();
    fireEvent.click(screen.getByRole('button', { name: /INITIATE_RECORD_PATH/ }));
    expect(h.onRecord).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'CLOSE_TERMINAL' }));
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });

  it('while recording: the count, Publish, and Abort as a neutral button (not red)', () => {
    const h = show({ recording: true, points: 7 });
    expect(screen.getByText(/RECORDING ACTIVE — 7 NODES CAPTURED/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /PUBLISH_ROUTE/ }));
    const abort = screen.getByRole('button', { name: /ABORT/ });
    expect(abort.className).not.toMatch(/danger|red/);
    fireEvent.click(abort);
    expect(h.onPublish).toHaveBeenCalledTimes(1);
    expect(h.onAbort).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('admin-tools').outerHTML).not.toMatch(OLD_LOOK);
  });

  it('ends above the Emergency button, and stands under it', () => {
    show();
    const backdrop = screen.getByTestId('admin-tools');
    expect(backdrop.style.paddingBottom).toBe('var(--emergency-clearance)');
    expect(backdrop.className).toContain('z-[6000]');
  });
});

describe('the recording bar', () => {
  it('shows the count, Publish and a neutral Abort, in the new look', () => {
    const onPublish = vi.fn();
    const onAbort = vi.fn();
    render(<RecordingBar points={3} onPublish={onPublish} onAbort={onAbort} />);
    expect(screen.getByRole('status').textContent).toBe('RECORDING_NODES: 3');
    fireEvent.click(screen.getByRole('button', { name: 'PUBLISH' }));
    fireEvent.click(screen.getByRole('button', { name: 'ABORT' }));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('recording-bar').outerHTML).not.toMatch(OLD_LOOK);
  });
});
