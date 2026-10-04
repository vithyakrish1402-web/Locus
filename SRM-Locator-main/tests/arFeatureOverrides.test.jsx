// @vitest-environment jsdom
//
// AR Scan Stage 6: each feature's override reaches what AR Scan draws, whatever the main
// dial says. Both three.js modules are stood in for, so these run without WebGL.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../src/utils/arRoadScene.js', () => ({
  createRoadView: () => ({ setRoad: vi.fn(), setOrientation: vi.fn(), setView: vi.fn(), render: vi.fn(), dispose: vi.fn() }),
}));
vi.mock('../src/utils/arArrowScene.js', () => ({
  createArrowView: () => ({ setRotation: vi.fn(), setView: vi.fn(), render: vi.fn(), dispose: vi.fn() }),
}));
// The real compass hook, watched for what ARCompass asks of it.
const hookCalls = vi.hoisted(() => []);
vi.mock('../src/hooks/useDeviceHeading.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useDeviceHeading: (options) => { hookCalls.push(options); return actual.useDeviceHeading(options); } };
});

const { default: ARCompass } = await import('../src/ARCompass.jsx');

beforeEach(() => { hookCalls.length = 0; });
afterEach(cleanup);

const HERE = { lat: 12.8230, lng: 80.0440 };
const north = (m, east = 0) => ({ lat: HERE.lat + m / 111320, lng: HERE.lng + east / (111320 * Math.cos((HERE.lat * Math.PI) / 180)) });
const RALLY = { name: 'RALLY_ALPHA', ...north(120) };
const ROUTE = [HERE, north(60), north(60, 5), north(120)];
const BUILDINGS = [{ id: 'b1', name: 'TECH PARK', ...north(90, -20) }, { id: 'b2', name: 'LIBRARY', ...north(40, 8) }];

const open = async ({ fidelity, overrides, routePath = ROUTE }) => {
  render(
    <ARCompass target={RALLY} liveLocation={HERE} routePath={routePath} buildings={BUILDINGS}
      fidelity={fidelity} overrides={overrides} onClose={() => {}} />,
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha: 0 });
  act(() => window.dispatchEvent(event));
  await act(async () => {}); // the dynamic imports settle
};
const OV = (o) => ({ tags: 'auto', roadLine: 'auto', arrow: 'auto', ...o });

const DIALS = ['efficient', 'standard', 'realistic'];
const drawn = () => ({
  road: screen.queryByTestId('ar-road-gl') ? '3d' : screen.queryByTestId('ar-road-line') ? 'ribbon' : 'none',
  arrow: screen.queryByTestId('ar-arrow-gl') ? '3d' : screen.queryByTestId('ar-arrow-3d') ? 'css' : 'none',
  ambient: screen.queryAllByTestId('ar-tag').filter((t) => t.dataset.variant !== 'target').length,
  target: screen.queryAllByTestId('ar-tag').some((t) => t.dataset.variant === 'target'),
  ring: screen.getByTestId('ar-arrow-ring').dataset.fidelity,
  tilt: hookCalls.at(-1)?.tilt,
});

describe('the road line override, under every dial', () => {
  const expected = { off: 'none', efficient: 'ribbon', realistic: '3d' };
  for (const dial of DIALS) {
    for (const override of ['auto', 'off', 'efficient', 'realistic']) {
      it(`${override} with the dial on ${dial}`, async () => {
        await open({ fidelity: dial, overrides: OV({ roadLine: override }) });
        const resolved = override === 'auto' ? dial : override;
        const want = expected[resolved] ?? 'ribbon'; // 'standard' draws the ribbon
        expect(drawn().road).toBe(want);
        // The phone's tilt is read in every mode: the tags are anchored through it
        // (Landmark Anchor Engine), not only the 3D road.
        expect(drawn().tilt).toBe(true);
        // The arrow follows its own setting (auto: the dial), untouched by the road's.
        expect(drawn().arrow).toBe(dial === 'realistic' ? '3d' : 'css');
      });
    }
  }

  it('leaves the destination tag where it is with the road on, off or absent: one camera for all', async () => {
    const targetTop = () => parseFloat(screen.getAllByTestId('ar-tag').find((t) => t.dataset.variant === 'target').style.top);
    await open({ fidelity: 'standard', overrides: OV() });
    const onRoad = targetTop();
    cleanup();
    await open({ fidelity: 'standard', overrides: OV({ roadLine: 'off' }) });
    const offRoad = targetTop();
    cleanup();
    await open({ fidelity: 'standard', overrides: OV(), routePath: null });
    expect(offRoad).toBeCloseTo(onRoad, 3);
    expect(targetTop()).toBeCloseTo(onRoad, 3);
  });
});

describe('the arrow override, under every dial', () => {
  for (const dial of DIALS) {
    for (const override of ['auto', 'efficient', 'realistic']) {
      it(`${override} with the dial on ${dial}`, async () => {
        await open({ fidelity: dial, overrides: OV({ arrow: override }) });
        const resolved = override === 'auto' ? dial : override;
        expect(drawn().arrow).toBe(resolved === 'realistic' ? '3d' : 'css');
        expect(drawn().ring).toBe(resolved);
      });
    }
  }

  it('has no off: an off override leaves it following the dial', async () => {
    await open({ fidelity: 'realistic', overrides: OV({ arrow: 'off' }) });
    expect(drawn().arrow).toBe('3d');
    cleanup();
    await open({ fidelity: 'standard', overrides: OV({ arrow: 'off' }) });
    expect(drawn().arrow).toBe('css');
  });
});

describe('the ambient tags override', () => {
  for (const dial of DIALS) {
    it(`off hides the ambient tags but keeps the destination’s, with the dial on ${dial}`, async () => {
      await open({ fidelity: dial, overrides: OV() });
      expect(drawn().ambient).toBeGreaterThan(0);
      cleanup();
      await open({ fidelity: dial, overrides: OV({ tags: 'off' }) });
      expect(drawn().ambient).toBe(0);
      expect(drawn().target).toBe(true);
    });
  }
});

describe('the motivating case: an older phone on REALISTIC', () => {
  it('road off, arrow left on auto: the 3D arrow, no road, the destination still anchored', async () => {
    await open({ fidelity: 'realistic', overrides: OV({ roadLine: 'off' }) });
    expect(drawn()).toMatchObject({ road: 'none', arrow: '3d', tilt: true, target: true });
  });

  it('road efficient, arrow left on auto: the 3D arrow over the light ribbon', async () => {
    await open({ fidelity: 'realistic', overrides: OV({ roadLine: 'efficient' }) });
    expect(drawn()).toMatchObject({ road: 'ribbon', arrow: '3d', tilt: true });
  });
});
