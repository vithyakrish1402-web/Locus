// @vitest-environment jsdom
//
// AR Scan points its arrow with the same fused heading as the live map marker: GPS course
// while walking, the (smoothed) compass otherwise. It used to read the raw compass alone.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

// The arrow's rotation, exposed as an attribute instead of an animated transform.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ animate, children, className }) => (
      <div data-testid="ar-arrow" data-rotate={animate?.rotate} className={className}>{children}</div>
    ),
  },
}));

const { default: ARCompass } = await import('../src/ARCompass.jsx');

afterEach(cleanup);

const TARGET = { name: 'EAST GATE', lat: 12.8205, lng: 81.0 }; // far due east of both fixes
const START = { lat: 12.8200, lng: 80.0400 };
const NORTH = { lat: 12.8210, lng: 80.0400 }; // one fix later, walking north

const compass = (heading) => {
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha: 360 - heading });
  window.dispatchEvent(event);
};
// The arrow's rotation accumulates past 360 on purpose (normalizeRotationDelta); fold it to (-180, 180].
const rotation = () => {
  const r = ((Number(screen.getByTestId('ar-arrow').getAttribute('data-rotate')) % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
};

const openAr = async (speedMps) => {
  const view = render(<ARCompass target={TARGET} liveLocation={START} speedMps={speedMps} onClose={() => {}} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  act(() => compass(180)); // phone says it faces south
  view.rerender(<ARCompass target={TARGET} liveLocation={NORTH} speedMps={speedMps} onClose={() => {}} />);
  return view;
};

describe('ARCompass heading', () => {
  it('while walking, trusts the GPS course over the compass', async () => {
    await openAr(2);
    expect(rotation()).toBeCloseTo(90, 0); // target east, heading north
  });

  it('standing still, uses the compass', async () => {
    await openAr(0);
    expect(rotation()).toBeCloseTo(-90, 0); // target east, heading south
  });
});
