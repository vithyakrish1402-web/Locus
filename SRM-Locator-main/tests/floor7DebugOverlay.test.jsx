// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import floor7Aps from '../src/data/floor7Aps.json';
import { Floor7DebugView } from '../src/components/Floor7DebugOverlay.jsx';
import { floor7Geometry } from '../src/utils/floor7Demo.js';

afterEach(cleanup);

const step = (x, y, status = 'tracking', rawX = x + 2) => ({ at: 1, raw: { x: rawX, y }, filtered: { x, y }, status, uncertaintyM: 6 });

describe('the Floor 7 debug view', () => {
  it('draws the plan: every walkable area, wall, spot and access point', () => {
    const { container, getByText } = render(<Floor7DebugView />);
    expect(container.querySelectorAll('polygon')).toHaveLength(floor7Geometry.walkable.length);
    expect(container.querySelectorAll('line')).toHaveLength(floor7Geometry.walls.length);
    expect(container.querySelectorAll('rect')).toHaveLength(floor7Aps.radios.length);
    for (const name of Object.keys(floor7Geometry.spots)) expect(getByText(name)).toBeTruthy();
  });

  it('draws nothing for the track before there is one', () => {
    const { container } = render(<Floor7DebugView />);
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('draws each raw estimate, the filtered track, and the current position with its uncertainty', () => {
    const trail = [step(0, 4), step(1, 4), step(2, 4)];
    const { container } = render(<Floor7DebugView trail={trail} />);
    expect(container.querySelector('polyline').getAttribute('points')).toBe('0,-4 1,-4 2,-4');
    // 14 spot dots + 3 raw dots + the uncertainty ring + the current dot
    expect(container.querySelectorAll('circle')).toHaveLength(14 + 3 + 2);
  });

  it('colours the current position by status, and shows a rejection in amber', () => {
    const colorOf = (status) => {
      const { container, unmount } = render(<Floor7DebugView trail={[step(0, 0, status)]} />);
      const circles = [...container.querySelectorAll('circle')];
      const fill = circles.at(-1).getAttribute('fill');
      unmount();
      return fill;
    };
    expect(colorOf('tracking')).toBe('#10B981');
    expect(colorOf('rejected')).toBe('#F59E0B');
    expect(colorOf('reacquiring')).toBe('#F97316');
  });

  it('flips the plan so that y points up the screen', () => {
    const { container } = render(<Floor7DebugView trail={[step(3, 7)]} />);
    const current = [...container.querySelectorAll('circle')].at(-1);
    expect(current.getAttribute('cy')).toBe('-7');
  });
});
