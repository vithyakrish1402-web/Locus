// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import floor7Aps from '../src/data/floor7Aps.json';
import Floor7DebugOverlay, { Floor7DebugView } from '../src/components/Floor7DebugOverlay.jsx';
import { layoutRadios, radioFlags, radioLabel } from '../src/utils/floor7RadioLayout.js';
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

  it('draws the raw estimate but no green position or ring while the start is still being confirmed', () => {
    const waiting = { at: 1, raw: { x: 3, y: 2 }, snapped: { x: 3, y: 0 }, filtered: null, status: 'confirming', uncertaintyM: 0 };
    const { container } = render(<Floor7DebugView trail={[waiting, { ...waiting, at: 2 }]} />);
    expect(container.querySelectorAll('[data-dot="raw"]')).toHaveLength(2);
    expect(container.querySelector('[data-dot="current"]')).toBeNull();
    expect(container.querySelector('[data-dot="uncertainty"]')).toBeNull();
    expect(container.querySelector('[data-track]')).toBeNull();
  });

  it('draws the track from the steps that have a position, skipping the waiting ones', () => {
    const waiting = { at: 1, raw: { x: 3, y: 2 }, snapped: { x: 3, y: 0 }, filtered: null, status: 'confirming', uncertaintyM: 0 };
    const { container } = render(<Floor7DebugView trail={[waiting, step(0, 4), step(0, 5)]} />);
    expect(container.querySelector('[data-track]').getAttribute('points')).toBe(`${px(0, 4).x},${px(0, 4).y} ${px(0, 5).x},${px(0, 5).y}`);
    expect(container.querySelectorAll('[data-dot="current"]')).toHaveLength(1);
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

describe('every access point can be reviewed by eye', () => {
  const radios = floor7Aps.radios;

  it('draws all of them, each once, each named by its last two bytes', () => {
    const { container } = render(<Floor7DebugView />);
    const drawn = [...container.querySelectorAll('[data-radio]')];
    expect(drawn.map((g) => g.dataset.radio).sort()).toEqual(radios.map((r) => r.radio).sort());
    expect(radios).toHaveLength(38);
    for (const r of radios) expect(container.querySelector(`[data-radio="${r.radio}"] text`).textContent).toBe(radioLabel(r.radio));
    expect(radioLabel('54:f0:b1:3e:5b')).toBe('3e:5b');
  });

  it('keeps every marker clear of every other and inside the drawing, even where radios share a spot', () => {
    const marks = layoutRadios(radios);
    expect(marks).toHaveLength(38);
    for (const m of marks) {
      expect(m.x).toBeGreaterThan(20);
      expect(m.x).toBeLessThan(PLAN_SVG.width - 20);
      expect(m.y).toBeGreaterThan(20);
      expect(m.y).toBeLessThan(PLAN_SVG.height - 20);
    }
    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) {
        expect(Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y), `${marks[i].label} / ${marks[j].label}`).toBeGreaterThan(30);
      }
    }
  });

  it('puts a lone radio exactly on its spot, and fans a crowd out around it with a line back to the true spot', () => {
    const lone = layoutRadios([{ radio: 'aa:aa:aa:aa:aa', x: -9, y: 11.75 }]);
    expect(lone[0]).toMatchObject({ x: px(-9, 11.75).x, y: px(-9, 11.75).y, fanned: false });
    const crowd = layoutRadios(['aa', 'bb', 'cc', 'dd'].map((id) => ({ radio: `${id}:aa:aa:aa:aa`, x: 11, y: 0 })));
    expect(crowd.every((m) => m.fanned && m.ax === px(11, 0).x && m.ay === px(11, 0).y)).toBe(true);
    expect(new Set(crowd.map((m) => `${m.x.toFixed(1)},${m.y.toFixed(1)}`)).size).toBe(4);
    const { container } = render(<Floor7DebugView radios={crowd.map((m) => ({ radio: m.radio, x: 11, y: 0, bssids: [], basis: 'best', guess: [] }))} />);
    expect(container.querySelectorAll('[data-radio] line')).toHaveLength(4);
  });

  it('keeps the true spot of every fanned radio, so nothing is moved without saying so', () => {
    for (const m of layoutRadios(radios)) {
      const r = radios.find((x) => x.radio === m.radio);
      expect(m.ax).toBeCloseTo(px(r.x, r.y).x, 6);
      expect(m.ay).toBeCloseTo(px(r.x, r.y).y, 6);
    }
  });

  it('colours by how the radio was placed, and marks single-spot (amber) and guess-based (orange dashed edge) ones', () => {
    const one = (r) => {
      const { container, unmount } = render(<Floor7DebugView radios={[{ radio: 'aa:aa:aa:aa:aa', x: 0, y: 0, bssids: [], basis: 'best', guess: [], single_spot: false, ...r }]} />);
      const rect = container.querySelector('[data-radio] rect');
      const out = [rect.getAttribute('fill'), rect.getAttribute('stroke'), rect.getAttribute('stroke-dasharray')];
      unmount();
      return out;
    };
    expect(one({})).toEqual(['#A78BFA', '#1B2630', null]);
    expect(one({ basis: 'tie' })[0]).toBe('#C4B5FD');
    expect(one({ basis: 'override' })[0]).toBe('#38BDF8');
    expect(one({ single_spot: true })[0]).toBe('#F59E0B');
    expect(one({ guess: ['Room 702 position is a guess'] })).toEqual(['#A78BFA', '#F97316', '3 2']);
  });

  it('describes each radio in a tooltip: where, how many BSSIDs, and what to check', () => {
    const { container } = render(<Floor7DebugView />);
    const r = radios.find((x) => x.single_spot && x.guess.length);
    const title = container.querySelector(`[data-radio="${r.radio}"] title`).textContent;
    expect(title).toContain(r.radio);
    expect(title).toContain(`${r.bssids.length} BSSIDs`);
    expect(title).toContain('heard at one spot only');
    expect(title).toContain('rests on a guess');
  });

  it('says in words what to check about a radio', () => {
    expect(radioFlags({ basis: 'best', guess: [] })).toEqual([]);
    expect(radioFlags({ basis: 'tie', single_spot: true, guess: ['x'] })).toEqual(['between two spots', 'heard at one spot only', 'rests on a guess']);
    expect(radioFlags({ basis: 'override', guess: [] })).toEqual(['placed by hand']);
  });
});

describe('the plan panel on the main map (Developer mode > Floor 7 map overlay)', () => {
  it('has no pill of its own and none of the access point wall: just the plan, a sentence and a way to hide it', () => {
    const onClose = vi.fn();
    render(<Floor7DebugOverlay onClose={onClose} />);
    expect(screen.getByTestId('floor7-debug')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /F7/ })).toBeNull();
    expect(screen.queryByTestId('floor7-radio-list')).toBeNull();
    expect(screen.getByTestId('floor7-debug').querySelectorAll('rect')).toHaveLength(0);
    expect(screen.getByText('No Floor 7 reading yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the plan' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('can leave the access points out of the plan, and ring the next door', () => {
    const { container } = render(<Floor7DebugView showRadios={false} target={{ x: -9, y: 11.75 }} />);
    expect(container.querySelectorAll('rect')).toHaveLength(0);
    expect(container.querySelector('[data-dot="target"]')).toBeTruthy();
    const withAps = render(<Floor7DebugView />);
    expect(withAps.container.querySelectorAll('rect')).toHaveLength(floor7Aps.radios.length);
    expect(withAps.container.querySelector('[data-dot="target"]')).toBeNull();
  });
});
