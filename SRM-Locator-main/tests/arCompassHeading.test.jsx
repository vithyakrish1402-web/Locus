// @vitest-environment jsdom
//
// AR Scan points its arrow by where the camera points: the phone's own smoothed heading, walking
// or not. It took the map marker's GPS course while walking (2026-10 to 1.1.82), which left the
// arrow up to 90 deg off when the phone was turned away from the way you walked.
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
const { magneticDeclination } = await import('../src/utils/declination.js');
const { calculateBearing } = await import('../src/utils/geoMath.js');

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
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
  act(() => compass(180)); // phone says it faces south
  view.rerender(<ARCompass target={TARGET} liveLocation={NORTH} speedMps={speedMps} onClose={() => {}} />);
  return view;
};

describe('ARCompass heading', () => {
  it('while walking north with the phone facing south, follows the phone, not the walking direction', async () => {
    await openAr(2);
    const declination = magneticDeclination(12.82, 80.04);
    const bearing = calculateBearing(NORTH.lat, NORTH.lng, TARGET.lat, TARGET.lng); // ~90
    expect(rotation()).toBeCloseTo(bearing - (180 + declination), 1);
  });

  it('standing still, uses the compass, corrected to true north', async () => {
    await openAr(0);
    // Target east; the phone faces magnetic south, which is true 180 + declination
    // (WMM2025, about -1.1 deg here: the declination grid point AR Scan uses).
    const declination = magneticDeclination(12.82, 80.04);
    expect(declination).toBeLessThan(-0.5);
    const bearing = calculateBearing(NORTH.lat, NORTH.lng, TARGET.lat, TARGET.lng); // ~90
    expect(rotation()).toBeCloseTo(bearing - (180 + declination), 1);
  });
});
