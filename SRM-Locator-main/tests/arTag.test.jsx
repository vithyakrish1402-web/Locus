// @vitest-environment jsdom
//
// One AR Scan label on its translucent plate (redesign AR Scan batch, piece 5).
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ARTag from '../src/components/ARTag.jsx';
import { TAG_LABEL_HEIGHT_PX } from '../src/utils/landmarkAnchorEngine.js';

afterEach(cleanup);

const renderTag = (props) => {
  render(<ARTag name="TECH PARK" distanceText="450 m" x={50} y={40} variant="building" {...props} />);
  return screen.getByTestId('ar-tag');
};
const plate = (tag) => tag.querySelector('.ar-plate');

describe('a label', () => {
  it('sits on a translucent plate, name and distance on one line', () => {
    const tag = renderTag();
    expect(plate(tag)).toBeTruthy();
    expect(tag.textContent).toBe('TECH PARK450 m');
  });

  it('is as tall as the layout engine plans for (h-6 = 24 px), so labels never overlap', () => {
    const tag = renderTag();
    expect(plate(tag).className).toMatch(/(^| )h-6( |$)/);
    expect(TAG_LABEL_HEIGHT_PX).toBe(24);
  });

  it("the destination: a 2 px accent border and a pin", () => {
    const tag = renderTag({ variant: 'target' });
    expect(plate(tag).className).toMatch(/border-2 border-accent/);
    expect(tag.querySelector('svg.lucide-map-pin')).toBeTruthy();
  });

  it('a group member: their initials', () => {
    const tag = renderTag({ variant: 'member', name: 'Meera Iyer' });
    expect(tag.querySelector('[aria-hidden="true"]').textContent).toBe('MI');
  });

  it('an edge tag points off-screen and draws no tick or dot', () => {
    const tag = renderTag({ edge: 'right' });
    expect(tag.querySelector('svg.lucide-chevron-right')).toBeTruthy();
    expect(tag.lastElementChild.querySelector('span')).toBeNull();
  });

  it('never red, never the old tactical look', () => {
    for (const variant of ['target', 'member', 'building']) {
      const tag = renderTag({ variant });
      expect(tag.outerHTML).not.toMatch(/red-|#EF4444|font-dot|bg-black/);
      cleanup();
    }
  });
});
