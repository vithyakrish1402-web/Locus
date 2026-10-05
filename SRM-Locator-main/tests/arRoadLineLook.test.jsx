// @vitest-environment jsdom
//
// AR Scan's road line looks like a band in the accent (redesign AR Scan batch, piece 7):
// narrowing and fading into the distance, never red.
import React from 'react';
import fs from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ARRoadLine from '../src/components/ARRoadLine.jsx';

afterEach(cleanup);

// Wide at your feet (the bottom of the screen), narrow far off.
const RIBBON = {
  left: [{ x: 150, y: 800 }, { x: 195, y: 500 }],
  right: [{ x: 250, y: 800 }, { x: 205, y: 500 }],
  nearY: 800,
  farY: 500,
};
const css = fs.readFileSync(`${process.cwd()}/src/index.css`, 'utf8');

describe('the road line', () => {
  it('fades along the band in the accent', () => {
    render(<ARRoadLine ribbon={RIBBON} width={400} height={900} />);
    const svg = screen.getByTestId('ar-road-line');
    const stops = svg.querySelectorAll('stop');
    expect(stops).toHaveLength(2);
    for (const stop of stops) expect(stop.getAttribute('class')).toBe('ar-road-stop');
    expect(Number(stops[0].getAttribute('stop-opacity'))).toBeGreaterThan(Number(stops[1].getAttribute('stop-opacity')));
    expect(css).toMatch(/\.ar-road-stop \{ stop-color: var\(--color-accent\); \}/);
  });

  it('a level band is filled flat in the accent', () => {
    render(<ARRoadLine ribbon={{ ...RIBBON, farY: 800 }} width={400} height={900} />);
    expect(screen.getByTestId('ar-road-line').querySelector('polygon').getAttribute('class')).toBe('ar-road-fill');
    expect(css).toMatch(/\.ar-road-fill \{ fill: var\(--color-accent\); \}/);
  });

  it('never red', () => {
    for (const farY of [500, 800]) {
      render(<ARRoadLine ribbon={{ ...RIBBON, farY }} width={400} height={900} />);
      expect(screen.getByTestId('ar-road-line').outerHTML).not.toMatch(/#EF4444|red/i);
      cleanup();
    }
  });
});
