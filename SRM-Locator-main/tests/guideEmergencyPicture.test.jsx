// @vitest-environment jsdom
//
// The guide's step 5 picture, redrawn for the Emergency button's new look (Emergency batch, E6):
// the button's own two holds, then the alert sent.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import Guide from '../src/components/guide/Guide.jsx';
import { GUIDE } from '../src/copy/guide.js';

MotionGlobalConfig.skipAnimations = true;
afterEach(cleanup);

describe("the guide's Emergency picture", () => {
  it("step 5's picture draws the button's two holds and the sent state, in the button's own look", () => {
    render(<Guide onDone={() => {}} initialStep={4} />);
    const rings = screen.getAllByTestId('guide-sos-ring');
    expect(rings).toHaveLength(3);
    const discs = rings.map((ring) => ring.previousElementSibling);
    // Hold: red with a casing; hold again: armed, white (no red edge, as on the button); sent: a tick.
    expect(discs[0].className).toMatch(/bg-danger /);
    expect(discs[0].textContent).toBe(GUIDE.picture.sos);
    expect(discs[1].className).toMatch(/bg-surface/);
    expect(discs[1].className).toMatch(/border-surface/);
    expect(discs[1].className).not.toMatch(/border-danger/);
    expect(discs[1].textContent).toBe(GUIDE.picture.sos);
    expect(discs[2].querySelector('svg')).toBeTruthy();
    expect(discs[2].textContent).toBe('');
    // The three captions are the step names, unchanged.
    GUIDE.picture.sosSteps.forEach((caption) => expect(screen.getByText(caption)).toBeTruthy());
    // The first hold's ring is part filled, the second's part drained, the last one full.
    const filled = rings.map((ring) => {
      const [track, arc] = ring.querySelectorAll('circle');
      expect(track.getAttribute('stroke')).toContain('danger-soft');
      const [drawn, around] = arc.getAttribute('stroke-dasharray').split(' ').map(Number);
      return drawn / around;
    });
    expect(filled[0]).toBeCloseTo(0.7);
    expect(filled[1]).toBeCloseTo(0.4);
    expect(filled[2]).toBeCloseTo(1);
  });
});
