// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import floor7Aps from '../src/data/floor7Aps.json';
import { Floor7DebugView } from '../src/components/Floor7DebugOverlay.jsx';
import { PLAN_SVG, buildPlan, floor7Plan } from '../src/utils/floor7Plan.js';
import planDoc from '../floor7-inputs/floor7_plan.json';

afterEach(cleanup);

const step = (x, y, status = 'tracking', raw = { x: x + 2, y: y + 1 }, snapped = { x, y }) => ({
  at: 1, raw, snapped, filtered: { x, y }, status, uncertaintyM: 6,
});
const px = (x, y) => floor7Plan.toSvg(x, y);

describe('the Floor 7 debug view', () => {
  it('draws the team\'s plan, the five corridor centrelines and every access point', () => {
    const { container } = render(<Floor7DebugView />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${PLAN_SVG.width} ${PLAN_SVG.height}`);
    expect(decodeURIComponent(container.querySelector('image').getAttribute('href'))).toContain('TECH PARK, Floor 7: draft plan');
    expect([...container.querySelectorAll('[data-centreline]')].map((n) => n.dataset.centreline).sort()).toEqual(
      ['east_back', 'east_spine', 'passage', 'west_back', 'west_spine']
    );
    expect(container.querySelectorAll('rect')).toHaveLength(floor7Aps.radios.length);
  });

  it('puts each centreline on its drawn pixels: the west spine runs x = 240 from y 740 up to 200', () => {
    const { container } = render(<Floor7DebugView />);
    expect(container.querySelector('[data-centreline="west_spine"]').getAttribute('points')).toBe('240,740 240,200');
    expect(container.querySelector('[data-centreline="passage"]').getAttribute('points')).toBe('240,500 1160,500');
  });

  it('draws nothing for the track before there is one', () => {
    const { container } = render(<Floor7DebugView />);
    expect(container.querySelector('[data-track]')).toBeNull();
    expect(container.querySelector('[data-dot]')).toBeNull();
  });

  it('draws each raw estimate, its snapped point, the link between them and the filtered track', () => {
    const trail = [step(-9, 4), step(-9, 5), step(-9, 6)];
    const { container } = render(<Floor7DebugView trail={trail} />);
    expect(container.querySelectorAll('[data-dot="raw"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-dot="snapped"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-snap-link]')).toHaveLength(3);
    const a = px(-9, 4);
    const b = px(-9, 5);
    const c = px(-9, 6);
    expect(container.querySelector('[data-track]').getAttribute('points')).toBe(`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`);
    const raw = container.querySelector('[data-dot="raw"]');
    expect([+raw.getAttribute('cx'), +raw.getAttribute('cy')]).toEqual([px(-7, 5).x, px(-7, 5).y]);
    const snapped = container.querySelector('[data-dot="snapped"]');
    expect([+snapped.getAttribute('cx'), +snapped.getAttribute('cy')]).toEqual([a.x, a.y]);
  });

  it('copes with a step that has no snapped point', () => {
    const { container } = render(<Floor7DebugView trail={[{ ...step(0, 0), snapped: undefined }]} />);
    expect(container.querySelectorAll('[data-dot="raw"]')).toHaveLength(1);
    expect(container.querySelector('[data-dot="snapped"]')).toBeNull();
  });

  it('colours the current position by status, and shows a rejection in amber', () => {
    const colorOf = (status) => {
      const { container, unmount } = render(<Floor7DebugView trail={[step(0, 0, status)]} />);
      const fill = container.querySelector('[data-dot="current"]').getAttribute('fill');
      unmount();
      return fill;
    };
    expect(colorOf('tracking')).toBe('#10B981');
    expect(colorOf('rejected')).toBe('#F59E0B');
    expect(colorOf('reacquiring')).toBe('#F97316');
  });

  it('flips y so that north is up the screen, and sizes the uncertainty ring in real metres', () => {
    const { container } = render(<Floor7DebugView trail={[step(0, 5)]} />);
    const current = container.querySelector('[data-dot="current"]');
    expect(+current.getAttribute('cy')).toBe(500 - 5 * 20);
    expect(+container.querySelector('[data-dot="uncertainty"]').getAttribute('r')).toBe(6 * 20);
  });

  it('follows PLAN_SCALE: a plan drawn at twice the scale puts the same spot on the same pixels', () => {
    const doubled = buildPlan(planDoc, 2);
    const { container } = render(<Floor7DebugView plan={doubled} trail={[step(-18, 8)]} />);
    const current = container.querySelector('[data-dot="current"]');
    expect([+current.getAttribute('cx'), +current.getAttribute('cy')]).toEqual([px(-9, 4).x, px(-9, 4).y]);
    expect(+container.querySelector('[data-dot="uncertainty"]').getAttribute('r')).toBe(6 * 10);
  });
});
