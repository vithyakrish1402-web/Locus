// The plan at scale 1, for scripts that place things in plan metres as drawn (the access point
// file stores positions before PLAN_SCALE). Imports app source, so the Node shims go first.
import './registerShims.mjs';

const { buildPlan } = await import('../../src/utils/floor7Plan.js');

/** Builds the plan from the raw plan document at scale 1. */
export const drawnPlan = (planDoc) => buildPlan(planDoc, 1);

/**
 * `midpoint` for buildAnchors: the WALKING midpoint of two [x, y] spots along the corridor
 * graph, so a radio whose two best spots are on different corridors still sits on a corridor.
 */
export function walkingMidpoint(planDoc) {
  const plan = drawnPlan(planDoc);
  return (a, b) => {
    const m = plan.pointAlongWalk({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, 0.5);
    return [m.x, m.y];
  };
}
