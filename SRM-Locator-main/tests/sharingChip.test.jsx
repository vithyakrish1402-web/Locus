// @vitest-environment jsdom
//
// The sharing chip under the top bar (v1.1.69 recording: it opened and folded again and again, and
// showed its text cut off mid-word). It opens once per real event, holds, folds; a state that comes
// and goes quickly is not an event; hiding it does not reset it; its label never shows cut off.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { SharingChip, STATUS_PILL_EXPAND_HOLD_MS, STATUS_PILL_EVENT_SETTLE_MS } from '../src/components/map/TopBar.jsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const chip = () => screen.getByTestId('sharing-chip');
const open = () => chip().getAttribute('data-expanded') === 'true';
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe('the sharing chip', () => {
  it('holds the hold time named in the code (3500 ms), and the event settle time (800 ms)', () => {
    expect(STATUS_PILL_EXPAND_HOLD_MS).toBe(3500);
    expect(STATUS_PILL_EVENT_SETTLE_MS).toBe(800);
  });

  it('opens on its text, holds, then folds to its dot', () => {
    render(<SharingChip mode="ACTIVE" />);
    expect(open()).toBe(true);
    tick(STATUS_PILL_EXPAND_HOLD_MS - 1);
    expect(open()).toBe(true);
    tick(1);
    expect(open()).toBe(false);
    tick(60_000);
    expect(open()).toBe(false); // once, not again and again
  });

  it('opens again for a real change of what it says, once it has lasted, then folds again', () => {
    const { rerender } = render(<SharingChip mode="ACTIVE" />);
    tick(STATUS_PILL_EXPAND_HOLD_MS);
    expect(open()).toBe(false);
    rerender(<SharingChip mode="FROZEN" />);
    expect(chip().getAttribute('data-mode')).toBe('FROZEN'); // the words are right at once
    expect(open()).toBe(false);
    tick(STATUS_PILL_EVENT_SETTLE_MS);
    expect(open()).toBe(true);
    tick(STATUS_PILL_EXPAND_HOLD_MS);
    expect(open()).toBe(false);
  });

  it('does not open for a state that comes and goes within the settle time (a fix lost and found)', () => {
    const { rerender } = render(<SharingChip mode="ACTIVE" waiting={false} />);
    tick(STATUS_PILL_EXPAND_HOLD_MS);
    for (let i = 0; i < 6; i += 1) {
      rerender(<SharingChip mode="ACTIVE" waiting />);
      tick(STATUS_PILL_EVENT_SETTLE_MS / 2);
      expect(open()).toBe(false);
      rerender(<SharingChip mode="ACTIVE" waiting={false} />);
      tick(STATUS_PILL_EVENT_SETTLE_MS / 2);
      expect(open()).toBe(false);
    }
    tick(10_000);
    expect(open()).toBe(false);
  });

  it('is not reset by being hidden and shown again (a banner standing in its place)', () => {
    const { rerender } = render(<SharingChip mode="ACTIVE" />);
    tick(STATUS_PILL_EXPAND_HOLD_MS);
    expect(open()).toBe(false);
    for (let i = 0; i < 4; i += 1) {
      rerender(<SharingChip mode="ACTIVE" hidden />);
      expect(screen.queryByTestId('sharing-chip')).toBeNull();
      rerender(<SharingChip mode="ACTIVE" />);
      expect(open()).toBe(false); // it did not open afresh
    }
  });

  it('a tap opens and folds it by hand', () => {
    render(<SharingChip mode="ACTIVE" />);
    tick(STATUS_PILL_EXPAND_HOLD_MS);
    fireEvent.click(chip());
    expect(open()).toBe(true);
    fireEvent.click(chip());
    expect(open()).toBe(false);
  });

  it('never shows its text cut off: it fades out before the chip narrows, and the room comes before the fade in', () => {
    render(<SharingChip mode="ACTIVE" />);
    const label = () => chip().querySelector('.grid');
    // Open: the room is there at once (no width animation), and the text fades in.
    expect(label().style.gridTemplateColumns).toBe('1fr');
    expect(label().style.transition).toMatch(/^grid-template-columns 0s,/);
    tick(STATUS_PILL_EXPAND_HOLD_MS);
    // Folded: the text fades out first, the room goes only after (a delay as long as the fade).
    expect(label().style.gridTemplateColumns).toBe('0fr');
    expect(label().style.opacity).toBe('0');
    expect(label().style.transition).toMatch(/opacity (\d+)ms ease, grid-template-columns 0s linear \1ms/);
    // And the chip itself has no width of its own to tween.
    expect(chip().style.width).toBe('');
  });
});
