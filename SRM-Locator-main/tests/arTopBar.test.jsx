// @vitest-environment jsdom
//
// AR Scan's top controls (redesign AR Scan batch, piece 3): Close, the "Finding" pill, ALIGN
// in a small round button and Reset beside it only once aligned. A long press on the pill
// opens the debug overlay; an ordinary tap never does, and a long press is never also a tap.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ArTopBar, { DEBUG_LONG_PRESS_MS } from '../src/components/ar/ArTopBar.jsx';
import { AR_CONTROLS } from '../src/copy/arScan.js';

let h;
const renderBar = (props = {}) => {
  h = { onClose: vi.fn(), onAlign: vi.fn(), onReset: vi.fn(), onDebug: vi.fn(), onPick: vi.fn() };
  render(<ArTopBar targetName="TECH PARK" aligned={false} {...h} {...props} />);
  return screen.getByTestId('ar-target-pill');
};
const hold = (el, ms) => {
  fireEvent.pointerDown(el);
  act(() => { vi.advanceTimersByTime(ms); });
  fireEvent.pointerUp(el);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the controls', () => {
  it('Close closes; the pill says what AR Scan is finding', () => {
    const pill = renderBar();
    expect(pill.textContent).toContain('Finding');
    expect(pill.textContent).toContain('TECH PARK');
    fireEvent.click(screen.getByRole('button', { name: AR_CONTROLS.close }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('ALIGN is a small round button; Reset shows only once aligned', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: AR_CONTROLS.alignLabel }));
    expect(h.onAlign).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: AR_CONTROLS.resetLabel })).toBeNull();
    cleanup();
    renderBar({ aligned: true });
    fireEvent.click(screen.getByRole('button', { name: AR_CONTROLS.resetLabel }));
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });

  it('never red, never the old tactical words', () => {
    renderBar({ aligned: true });
    const bar = screen.getByTestId('ar-top-bar');
    expect(bar.outerHTML).not.toMatch(/red-|danger|font-dot/);
    expect(bar.textContent).not.toMatch(/AR_TRACKER|OPTICS|IFR|ALIGN|RESET/);
  });
});

describe('the debug overlay and the pill', () => {
  it('an ordinary tap never opens it, but opens the picker', () => {
    const pill = renderBar();
    hold(pill, 150);
    fireEvent.click(pill);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(h.onDebug).not.toHaveBeenCalled();
    expect(h.onPick).toHaveBeenCalledTimes(1);
  });

  it('a press just short of the long press opens nothing', () => {
    const pill = renderBar();
    hold(pill, DEBUG_LONG_PRESS_MS - 1);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(h.onDebug).not.toHaveBeenCalled();
  });

  it('a long press opens it, and is not also a tap', () => {
    const pill = renderBar();
    hold(pill, DEBUG_LONG_PRESS_MS);
    fireEvent.click(pill);
    expect(h.onDebug).toHaveBeenCalledTimes(1);
    expect(h.onPick).not.toHaveBeenCalled();
    // The next ordinary tap opens the picker again.
    hold(pill, 100);
    fireEvent.click(pill);
    expect(h.onPick).toHaveBeenCalledTimes(1);
  });

  it('moving off the pill cancels the long press', () => {
    const pill = renderBar();
    fireEvent.pointerDown(pill);
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.pointerLeave(pill);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(h.onDebug).not.toHaveBeenCalled();
  });

  it('without a picker the pill is a label, and still takes the long press', () => {
    const pill = renderBar({ onPick: null });
    expect(pill.tagName).toBe('DIV');
    hold(pill, DEBUG_LONG_PRESS_MS);
    expect(h.onDebug).toHaveBeenCalledTimes(1);
  });
});
