// @vitest-environment jsdom
//
// The meeting point plate is kept out from under the map's right-hand controls (Map batch
// fix 3): it slides left, at most until its right edge reaches the pin's centre.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import WaypointMarker from '../src/components/WaypointMarker.jsx';
import { shiftClearOf } from '../src/hooks/useClearOfControls.js';

// The controls column at a 412 px phone: x 345..401, y 300..520.
const CONTROLS = { left: 345, right: 401, top: 300, bottom: 520 };
const rect = (left, width, top = 400, height = 20) => ({ left, right: left + width, top, bottom: top + height, width, height });

describe('how far the plate moves', () => {
  it('not at all when it is clear of the controls', () => {
    expect(shiftClearOf(rect(100, 160), CONTROLS)).toBe(0);
  });

  it('not at all above or below the controls', () => {
    expect(shiftClearOf(rect(250, 160, 200), CONTROLS)).toBe(0);
    expect(shiftClearOf(rect(250, 160, 560), CONTROLS)).toBe(0);
  });

  it('left by the overlap, plus a small gap', () => {
    // right edge 410: 65 px past the controls' left edge, + 8 px gap.
    expect(shiftClearOf(rect(250, 160), CONTROLS)).toBe(73);
  });

  it('just touching counts, inside the gap', () => {
    expect(shiftClearOf(rect(180, 160), CONTROLS)).toBe(3);
  });

  it('never further than allowed', () => {
    expect(shiftClearOf(rect(250, 160), CONTROLS, { maxShift: 40 })).toBe(40);
  });

  it('not when there are no controls on screen', () => {
    expect(shiftClearOf(rect(250, 160), null)).toBe(0);
  });

  it('not when the plate is past the controls (off their right side)', () => {
    expect(shiftClearOf(rect(402, 160), CONTROLS)).toBe(0);
  });
});

describe('the meeting point plate on the map', () => {
  let plateRect;
  beforeEach(() => {
    vi.useFakeTimers();
    const controls = document.createElement('div');
    controls.dataset.testid = 'map-controls';
    controls.getBoundingClientRect = () => CONTROLS;
    document.body.appendChild(controls);
  });
  afterEach(() => {
    cleanup();
    document.querySelector('[data-testid="map-controls"]')?.remove();
    vi.useRealTimers();
  });

  const renderAt = (r) => {
    plateRect = r;
    render(<WaypointMarker name="TECH PARK" onClick={() => {}} />);
    const plate = screen.getByTestId('meeting-point-plate');
    // Where it is drawn: where it would sit, moved by whatever shift is on it now.
    plate.getBoundingClientRect = () => {
      const shift = Number((plate.style.translate.match(/^(-?[\d.]+)px/) || [0, 0])[1]);
      return { ...plateRect, left: plateRect.left + shift, right: plateRect.right + shift };
    };
    act(() => vi.advanceTimersByTime(1000)); // several checks: it must hold still, not flicker
    return plate;
  };

  it('stays put away from the controls', () => {
    const plate = renderAt(rect(100, 160));
    expect(plate.style.translate).toBe('');
  });

  it('slides left out from under the controls', () => {
    const plate = renderAt(rect(250, 160));
    expect(plate.style.translate).toBe('-73px 0');
  });

  it('follows the map: slides back once the map moves the pin away', () => {
    const plate = renderAt(rect(250, 160));
    expect(plate.style.translate).toBe('-73px 0');
    plateRect = rect(60, 160);
    act(() => vi.advanceTimersByTime(1000)); // several checks: it must hold still, not flicker
    expect(plate.style.translate).toBe('');
  });

  it('never leaves its pin: at most half its width', () => {
    const plate = renderAt(rect(330, 160));
    expect(plate.style.translate).toBe('-80px 0');
  });
});
