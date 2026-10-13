// Smooths the WiFi position estimate into a steady track, and refuses estimates a person
// could not have walked to. Works in metres in the Floor 7 plan frame (floor7Plan.js); the
// caller converts lat/lng.
//
// Position-only Kalman filter (state x, y; one shared variance), not constant velocity:
// estimates arrive about every 35 s, and over that long a person can stop, start or turn, so a
// velocity cannot be measured from them, and extrapolating one would overshoot by tens of
// metres. Standing still needs no special rule: the filter simply stops moving.
//
// Everything lives ON the corridor graph of the plan (floor7Plan.js: an H of corridors with two
// dead-end back paths, one route between any two points). Each update:
//   1. Snap the estimate onto the nearest corridor centreline. Because every position the
//      filter holds is on a corridor, it can never be inside a room, inside a wall, or off the
//      floor, and a move always follows the corridors: there is no separate wall check.
//   2. Predict: the position stays, the variance grows by PROCESS_NOISE_M2_PER_S * seconds.
//   3. Gate on WALKING distance along the corridors (not straight-line distance): an estimate
//      farther on foot than
//        min(MAX_WALK_SPEED_MPS * seconds_since_last_accepted + the filter's uncertainty, MAX_JUMP_M)
//      is rejected. At a 35 s step the speed term alone allows ~70 m, so MAX_JUMP_M is what
//      actually bites. This is what keeps a restroom's back path (a dead end ~8 m from the labs
//      on the map but ~40 m on foot) from being "jumped" into from the labs.
//   4. Correct: move toward the estimate by the Kalman gain, along the walking route.
// A rejected estimate leaves the position where it was and the uncertainty grows (coasting).
// REACQUIRE_AFTER_REJECTS rejections in a row mean the filter is lost, not the person: it
// restarts from the newest estimate.
//
// Measurement noise: sigma = MEASUREMENT_NOISE_BASE_M / max(confidence, MIN_CONFIDENCE),
// so a full-confidence estimate is trusted at the 4 m base error, 0.5 confidence at 8 m, and
// anything at or below 0.2 at 20 m. (Stage 5 confidence: 1 AP scores at most 0.2.)

export const MAX_WALK_SPEED_MPS = 2.0;
/** The most the position may move on one accepted update, as a WALK in metres. */
export const MAX_JUMP_M = 25;
export const REACQUIRE_AFTER_REJECTS = 2;
export const MEASUREMENT_NOISE_BASE_M = 4;
/** ~5 m of drift per 35 s step: sqrt(0.7 * 35) = 4.9. A guess; tune on the walk test. */
export const PROCESS_NOISE_M2_PER_S = 0.7;
export const MIN_CONFIDENCE = 0.2;

/**
 * UNUSED, kept so the number is written down: a GPS fix less accurate than this (metres)
 * would not be trusted. The Floor 7 demo takes no GPS at all: GPS never overrides a WiFi
 * position on this floor, and indoors it is not used for the demo. Nothing reads this.
 */
export const GPS_TRUST_MAX_ACCURACY_M = 50;

const measurementSigma = (confidence) => MEASUREMENT_NOISE_BASE_M / Math.max(confidence, MIN_CONFIDENCE);

/**
 * @param {object} options
 * @param {number} options.staleMs gap after which the old position is forgotten and the next
 *   estimate is taken as is. Pass the WiFi staleness constant (WIFI_ESTIMATE_MAX_AGE_MS): this
 *   module deliberately has no second one.
 * @param {object} options.plan the corridor graph (floor7Plan.js): snapToCorridor,
 *   walkingDistance, pointAlongWalk
 */
export function createPositionFilter({ staleMs, plan }) {
  let pos = null; // { x, y }, always on a corridor
  let variance = 0;
  let lastT = 0; // last update processed, accepted or not
  let lastAcceptedT = 0;
  let rejects = 0;
  let status = 'tracking';
  let lastSnapped = null; // the newest estimate, snapped onto a corridor

  const start = (snapped, confidence, t, newStatus) => {
    const sigma = measurementSigma(confidence);
    pos = { x: snapped.x, y: snapped.y };
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
      const snapped = plan.snapToCorridor(estimate.x, estimate.y);
      lastSnapped = { x: snapped.x, y: snapped.y };
      if (!pos || timestamp - lastAcceptedT > staleMs) {
        start(snapped, estimate.confidence, timestamp, 'tracking'); // first estimate, or after a long gap: taken as is
        return status;
      }

      const dt = Math.max(0, (timestamp - lastT) / 1000);
      variance += PROCESS_NOISE_M2_PER_S * dt;
      lastT = timestamp;

      const sigma = measurementSigma(estimate.confidence);
      const sinceAccepted = Math.max(0, (timestamp - lastAcceptedT) / 1000);
      const limit = Math.min(MAX_WALK_SPEED_MPS * sinceAccepted + Math.sqrt(variance), MAX_JUMP_M);

      if (plan.walkingDistance(pos, snapped) > limit) {
        rejects += 1;
        if (rejects >= REACQUIRE_AFTER_REJECTS) start(snapped, estimate.confidence, timestamp, 'reacquiring');
        else status = 'rejected';
        return status;
      }

      const gain = variance / (variance + sigma * sigma);
      pos = plan.pointAlongWalk(pos, snapped, gain);
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
    /** { x, y } in metres on a corridor, or null before the first estimate. */
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
    /** The newest estimate moved onto the nearest corridor (what the gate judged), or null. */
    get lastSnapped() {
      return lastSnapped && { ...lastSnapped };
    },
  };
}
