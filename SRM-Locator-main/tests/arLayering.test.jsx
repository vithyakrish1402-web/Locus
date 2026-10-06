// @vitest-environment jsdom
//
// What draws over what in AR Scan (redesign AR Scan batch): a label must never cover words
// or a button. The controls, notices and readout sit above the labels; the arrow below them,
// as the labels have always been drawn over it; the centre mark above the arrow.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

const { default: ARCompass } = await import('../src/ARCompass.jsx');

afterEach(cleanup);

const HERE = { lat: 12.8230, lng: 80.0440 };
const TARGET = { name: 'TECH PARK', lat: 12.8257, lng: 80.0440 };
const z = (el) => Number(/(?:^| )z-\[?(\d+)\]?(?: |$)/.exec(el.className)?.[1] ?? NaN);

const openAr = async () => {
  render(<ARCompass target={TARGET} liveLocation={HERE} onClose={() => {}} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
};

describe('AR Scan layering', () => {
  it("the HUD sets no stacking order of its own, so its parts layer against the labels", async () => {
    await openAr();
    expect(Number.isNaN(z(screen.getByTestId('ar-ui')))).toBe(true);
  });

  it('controls and notices above the labels', async () => {
    await openAr();
    const labels = z(screen.getByTestId('ar-labels'));
    const top = screen.getByTestId('ar-top');
    expect(z(top)).toBeGreaterThan(labels);
    for (const id of ['ar-target-pill', 'ar-calibration-banner', 'ar-camera-off']) {
      expect(top.contains(screen.getByTestId(id)), id).toBe(true);
    }
  });

  it('the readout above the labels', async () => {
    await openAr();
    expect(z(screen.getByTestId('ar-readout'))).toBeGreaterThan(z(screen.getByTestId('ar-labels')));
  });

  it('the arrow below the labels and the centre mark', async () => {
    await openAr();
    const arrow = z(screen.getByTestId('ar-arrow-ring'));
    expect(arrow).toBeLessThan(z(screen.getByTestId('ar-labels')));
    expect(arrow).toBeLessThan(z(screen.getByTestId('ar-centre-mark')));
  });
});
