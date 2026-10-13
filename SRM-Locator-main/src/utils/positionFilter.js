// Smooths the WiFi position estimate into a steady track, and refuses estimates a person
// could not have walked to. Works in metres in the Floor 7 frame (floor7Frame.js); the caller
// converts lat/lng.
//
// Position-only Kalman filter (state x, y; one shared variance), not constant velocity:
// estimates arrive about every 35 s, and over that long a person can stop, start or turn, so a
// velocity cannot be measured from them, and extrapolating one would overshoot by tens of
// metres. Standing still needs no special rule: the filter simply stops moving.
//
// Each update:
//   1. Predict: position stays, variance grows by PROCESS_NOISE_M2_PER_S * seconds.
//   2. Speed gate: an estimate farther from the prediction than
//        min(MAX_WALK_SPEED_MPS * seconds_since_last_accepted + its own noise, MAX_JUMP_M)
//      is rejected. At a 35 s step the speed term alone allows ~70 m, so MAX_JUMP_M is
//      what actually bites.
//   3. Correct: move toward the estimate by the Kalman gain.
//   4. Wall rule: snap the result into walkable space; if the straight path from the last
//      position to it crosses a wall, the update is rejected.
// A rejected estimate leaves the position where it was and the uncertainty grows (coasting).
// REACQUIRE_AFTER_REJECTS rejections in a row mean the filter is lost, not the person: it
// restarts from the newest estimate.
//
// Measurement noise: sigma = MEASUREMENT_NOISE_BASE_M / max(confidence, MIN_CONFIDENCE),
// so a full-confidence estimate is trusted at the 4 m base error, 0.5 confidence at 8 m, and
// anything at or below 0.2 at 20 m. (Stage 5 confidence: 1 AP scores at most 0.2.)

import { pathCrossesWall, snapToWalkable } from './floorGeometry.js';

export const MAX_WALK_SPEED_MPS = 2.0;
export const MAX_JUMP_M = 25;
export const REACQUIRE_AFTER_REJECTS = 2;
export const MEASUREMENT_NOISE_BASE_M = 4;
/** ~5 m of drift per 35 s step: sqrt(0.7 * 35) = 4.9. A guess; tune on the walk test. */
export const PROCESS_NOISE_M2_PER_S = 0.7;
export const MIN_CONFIDENCE = 0.2;

const measurementSigma = (confidence) => MEASUREMENT_NOISE_BASE_M / Math.max(confidence, MIN_CONFIDENCE);

/**
 * @param {object} options
 * @param {number} options.staleMs gap after which the old position is forgotten and the next
 *   estimate is taken as is. Pass the WiFi staleness constant (WIFI_ESTIMATE_MAX_AGE_MS): this
 *   module deliberately has no second one.
 * @param {{a:{x,y}, b:{x,y}}[]} [options.walls]
 * @param {{x,y}[][]} [options.walkable]
 */
export function createPositionFilter({ staleMs, walls = [], walkable = [] }) {
  let pos = null; // { x, y }
  let variance = 0;
  let lastT = 0; // last update processed, accepted or not
  let lastAcceptedT = 0;
  let rejects = 0;
  let status = 'tracking';

  const start = (est, t, newStatus) => {
    const sigma = measurementSigma(est.confidence);
    pos = snapToWalkable({ x: est.x, y: est.y }, walkable);
    variance = sigma * sigma;
    lastT = lastAcceptedT = t;
    rejects = 0;
    status = newStatus;
  };

  return {
    /**
     * @param {{x:number, y:number, confidence:number}} estimate metres, from toLocal()
     * @param {number} timestamp epoch ms
     */
    update(estimate, timestamp) {
      if (!Number.isFinite(estimate?.x) || !Number.isFinite(estimate?.y)) return status; // nothing to learn
      if (!pos || timestamp - lastAcceptedT > staleMs) {
        start(estimate, timestamp, 'tracking'); // first estimate, or after a long gap: taken as is
        return status;
      }

      const dt = Math.max(0, (timestamp - lastT) / 1000);
      variance += PROCESS_NOISE_M2_PER_S * dt;
      lastT = timestamp;

      const sigma = measurementSigma(estimate.confidence);
      const sinceAccepted = Math.max(0, (timestamp - lastAcceptedT) / 1000);
      const limit = Math.min(MAX_WALK_SPEED_MPS * sinceAccepted + sigma, MAX_JUMP_M);
      const gain = variance / (variance + sigma * sigma);
      const corrected = snapToWalkable(
        { x: pos.x + gain * (estimate.x - pos.x), y: pos.y + gain * (estimate.y - pos.y) },
        walkable
      );

      const tooFar = Math.hypot(estimate.x - pos.x, estimate.y - pos.y) > limit;
      if (tooFar || pathCrossesWall(pos, corrected, walls)) {
        rejects += 1;
        if (rejects >= REACQUIRE_AFTER_REJECTS) start(estimate, timestamp, 'reacquiring');
        else status = 'rejected';
        return status;
      }

      pos = corrected;
      variance *= 1 - gain;
      lastAcceptedT = timestamp;
      rejects = 0;
      status = 'tracking';
      return status;
    },
    reset() {
      pos = null;
      rejects = 0;
      status = 'tracking';
    },
    /** { x, y } in metres, or null before the first estimate. */
    get position() {
      return pos && { ...pos };
    },
    /** One standard deviation in metres, for the confidence halo. 0 before the first estimate. */
    get uncertaintyM() {
      return pos ? Math.sqrt(variance) : 0;
    },
    /** 'tracking' | 'rejected' | 'reacquiring' */
    get status() {
      return status;
    },
  };
}
