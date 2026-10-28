// @vitest-environment jsdom
//
// Turn-by-turn fixes (src/hooks/useNavigationController.js, components/navigation/NavigationHUD.jsx):
//  - the card says the next move with the distance to it, and under it the move after that with
//    the length of the stretch between them (it paired a turn already behind you with the distance
//    to the next one);
//  - far from any mapped path, it reroutes at most REROUTE_MAX_TRIES times in a row, then says
//    "No mapped path from here" with a button to try again (it said "Recalculating…" for good);
//  - the same route coming back from a reroute keeps your place in its instructions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { useNavigationController, REROUTE_MAX_TRIES, ROUTE_FAILURE } from '../src/hooks/useNavigationController';
import { TurnInstructionCard } from '../src/components/navigation/NavigationHUD';
import { fetchPedestrianRoute } from '../src/utils/routingProviders';

MotionGlobalConfig.skipAnimations = true;
vi.mock('../src/utils/routingProviders', () => ({ fetchPedestrianRoute: vi.fn() }));

// A straight walk north with two turns' worth of steps, about 110 m apart.
const p = (north, east = 0) => ({ lat: 12.82 + north / 111320, lng: 80.04 + east / 108600 });
const A = p(0);
const B = p(110);
const C = p(220);
const D = p(330);
const steps = [
  { instruction: 'Start walking', maneuver: 'depart', distanceMeters: 110, startLocation: A, endLocation: B },
  // A length of its own, so the card can't take the wrong stretch's.
  { instruction: 'Turn left', maneuver: 'turn-left', distanceMeters: 125, startLocation: B, endLocation: C },
  { instruction: 'Turn right', maneuver: 'turn-right', distanceMeters: 110, startLocation: C, endLocation: D },
  { instruction: 'Arrive at Library', maneuver: 'arrive', distanceMeters: 0, startLocation: D, endLocation: D },
];
const route = { path: [A, B, C, D], steps, isRealRoute: true };
const destination = D;

let clock;
beforeEach(() => {
  fetchPedestrianRoute.mockReset();
  let now = 1_000_000;
  clock = { tick: (ms) => { now += ms; } };
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const navigate = async (start = A) => {
  const view = renderHook(({ position }) => useNavigationController({
    isNavigating: true, destination, liveLocation: position,
  }), { initialProps: { position: start } });
  await waitFor(() => expect(view.result.current.activeRoute).toBe(route));
  return view;
};

// One off-route sample after another, far east of the path, each a little apart.
const offRoute = async (rerender, n, from = 0) => {
  for (let i = 0; i < n; i++) {
    clock.tick(7000);
    await act(async () => { rerender({ position: p(150, 200 + from + i) }); });
  }
};

describe('the turn card', () => {
  it('says the next move with the distance to it, then the one after with the stretch between', async () => {
    fetchPedestrianRoute.mockResolvedValue(route);
    const { result } = await navigate();
    expect(result.current.currentStepIndex).toBe(0);
    expect(result.current.upcomingStep.instruction).toBe('Turn left');
    expect(result.current.stepAfter.instruction).toBe('Turn right');
    expect(result.current.stepAfter.distanceMeters).toBe(125);
    render(<TurnInstructionCard currentStep={result.current.upcomingStep} nextStep={result.current.stepAfter}
      distanceToNextMeters={result.current.distanceToNextStepMeters} destinationName="Library" onEnd={() => {}} />);
    expect(screen.getByText(/Turn left/)).toBeTruthy();
  });

  it('on the last stretch, the next move is arriving, with nothing after it', async () => {
    fetchPedestrianRoute.mockResolvedValue(route);
    const { result, rerender } = await navigate();
    await act(async () => { rerender({ position: B }); });
    await act(async () => { rerender({ position: C }); });
    expect(result.current.currentStepIndex).toBe(2);
    expect(result.current.upcomingStep.maneuver).toBe('arrive');
    expect(result.current.stepAfter).toBeNull();
  });
});

describe('rerouting far from any mapped path', () => {
  it(`stops after ${REROUTE_MAX_TRIES} tries and says there is no mapped path, until Try again`, async () => {
    fetchPedestrianRoute.mockResolvedValue(route);
    const { result, rerender } = await navigate();
    expect(fetchPedestrianRoute).toHaveBeenCalledTimes(1);
    await offRoute(rerender, 3 * (REROUTE_MAX_TRIES + 2));
    expect(fetchPedestrianRoute).toHaveBeenCalledTimes(1 + REROUTE_MAX_TRIES);
    expect(result.current.rerouteError).toBe(ROUTE_FAILURE.noMappedPath);
    expect(result.current.isRerouting).toBe(false);

    const onRetry = vi.fn(() => result.current.retryReroute());
    render(<TurnInstructionCard currentStep={result.current.upcomingStep} rerouteError={result.current.rerouteError}
      onRetryReroute={onRetry} destinationName="Library" onEnd={() => {}} />);
    expect(screen.getByTestId('nav-failure').textContent).toMatch('No mapped path from here');
    await act(async () => { screen.getByRole('button', { name: 'Try again' }).click(); });
    expect(fetchPedestrianRoute).toHaveBeenCalledTimes(2 + REROUTE_MAX_TRIES);
  });

  it('walking back onto the route clears it and gives a fresh set of tries', async () => {
    fetchPedestrianRoute.mockResolvedValue(route);
    const { result, rerender } = await navigate();
    await offRoute(rerender, 3 * (REROUTE_MAX_TRIES + 1));
    expect(result.current.rerouteError).toBe(ROUTE_FAILURE.noMappedPath);
    await act(async () => { rerender({ position: p(60) }); });
    expect(result.current.rerouteError).toBeNull();
    const before = fetchPedestrianRoute.mock.calls.length;
    await offRoute(rerender, 3, 100);
    expect(fetchPedestrianRoute.mock.calls.length).toBe(before + 1);
  });
});

describe('a reroute that brings back the same route', () => {
  it('keeps your place in its instructions', async () => {
    fetchPedestrianRoute.mockResolvedValue(route);
    const { result, rerender } = await navigate();
    await act(async () => { rerender({ position: B }); });
    expect(result.current.currentStepIndex).toBe(1);
    await offRoute(rerender, 3);
    expect(fetchPedestrianRoute).toHaveBeenCalledTimes(2);
    expect(result.current.currentStepIndex).toBe(1);
  });
});
