// @vitest-environment jsdom
//
// AR Scan's 3D arrow (Stage 4): a wedge lying on a tilted ground plane, turned within that
// plane by the same wraparound-safe angle as before, chosen by AR_RENDER_MODE.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
// motion.div as a plain div that records what it was asked to animate, and how.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ animate, transition, className, style, children }) => (
      <div data-testid="ar-arrow-spinner" data-rotate={animate?.rotate} data-transition={JSON.stringify(transition)} className={className} style={style}>
        {children}
      </div>
    ),
  },
}));

import ARArrow3D, { ARROW_BASE_TILT_DEG, ARROW_PERSPECTIVE_PX, ARROW_THICKNESS_PX } from '../src/components/ARArrow3D.jsx';

const { default: ARCompass } = await import('../src/ARCompass.jsx');

afterEach(cleanup);

const zOf = (el) => Number(/translateZ\((-?[\d.]+)px\)/.exec(el.style.transform)[1]);

describe('ARArrow3D', () => {
  it('turns the arrow within a tilted plane, under a perspective', () => {
    render(<ARArrow3D rotation={90} transition={{ duration: 0 }} />);
    const wrapper = screen.getByTestId('ar-arrow-3d');
    const plane = screen.getByTestId('ar-arrow-plane');
    expect(wrapper.style.perspective).toBe(`${ARROW_PERSPECTIVE_PX}px`);
    expect(plane.style.transform).toBe(`rotateX(${ARROW_BASE_TILT_DEG}deg)`);
    expect(plane.style.transformStyle).toBe('preserve-3d');
    // The turning element sits inside the tilted plane (rotateX . rotateZ), not around
    // it, and keeps its children in 3D.
    const spinner = screen.getByTestId('ar-arrow-top').parentElement;
    expect(spinner.parentElement).toBe(plane);
    expect(spinner.style.transformStyle).toBe('preserve-3d');
    expect(plane.parentElement).toBe(wrapper);
  });

  it('has thickness: darker side layers stacked below a two-tone top face', () => {
    render(<ARArrow3D rotation={0} transition={{ duration: 0 }} />);
    const sides = screen.getAllByTestId('ar-arrow-side');
    const top = screen.getByTestId('ar-arrow-top');
    expect(sides.length).toBeGreaterThan(2);
    const sideZ = sides.map(zOf);
    expect(sideZ[0]).toBe(0);
    expect([...sideZ].sort((a, b) => a - b)).toEqual(sideZ);
    expect(zOf(top)).toBe(ARROW_THICKNESS_PX);
    expect(Math.max(...sideZ)).toBeLessThan(zOf(top));
    const fills = [...top.querySelectorAll('polygon')].map((p) => p.getAttribute('fill')).filter((f) => f !== 'none');
    expect(new Set(fills).size).toBe(2); // lit and shaded halves
    const sideFill = sides[1].querySelector('polygon').getAttribute('fill');
    expect(fills).not.toContain(sideFill);
  });
});

describe('ARCompass arrow by AR_RENDER_MODE', () => {
  const HERE = { lat: 12.8230, lng: 80.0440 };
  const open = async (fidelity) => {
    render(<ARCompass target={{ name: 'X', lat: 12.8240, lng: 80.0440 }} liveLocation={HERE} fidelity={fidelity} onClose={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  };

  // 'realistic' has its own arrow since Stage 5a: see arArrowRealistic.test.jsx.
  for (const fidelity of ['efficient', 'standard']) {
    it(`draws the 3D arrow for '${fidelity}'`, async () => {
      await open(fidelity);
      expect(screen.getByTestId('ar-arrow-ring').dataset.fidelity).toBe(fidelity);
      expect(screen.getByTestId('ar-arrow-3d')).toBeTruthy();
      expect(screen.getAllByTestId('ar-arrow-3d')).toHaveLength(1);
    });
  }

  it('turns by AR Scan’s angle on the same spring as before Stage 4', async () => {
    await open('standard');
    const spinner = screen.getByTestId('ar-arrow-spinner');
    // Target due north, phone facing north (no compass reading yet): 0 degrees.
    expect(Number(spinner.dataset.rotate)).toBeCloseTo(0, 6);
    expect(JSON.parse(spinner.dataset.transition)).toEqual({ type: 'spring', damping: 15, stiffness: 100 });
  });

  it('defaults to standard when no fidelity is given', async () => {
    await open(undefined);
    expect(screen.getByTestId('ar-arrow-ring').dataset.fidelity).toBe('standard');
    expect(screen.getByTestId('ar-arrow-3d')).toBeTruthy();
  });
});
