import { angularDifference } from './geoMath';

// AR Scan's compass pipeline, after the sensor and before the screen: the heading filter
// and the calibration banner's monitor. Pure, so both are tested with made-up readings.
// useDeviceHeading runs them once per sensor event, for the camera (AR Scan) only; the
// map's compass keeps its own simpler smoothing.
//
// --- Tuning. Every value here needs checking on a real walk (the debug overlay, a
// long-press on the AR_TRACKER title, shows what they produce). ---

// Heading filter: a circular low-pass whose time constant is how long it takes to cover
// about 63% of a step. Time-based, so it behaves the same at any sensor rate.
export const HEADING_TAU_MS = 250;      // normal: steady, a little behind a slow turn
export const HEADING_FAST_TAU_MS = 60;  // fast-response mode, while really turning
// Fast mode starts once the raw heading has stayed this far from the filtered one, on the
// same side, for this many readings in a row: a real turn does that, a one-off spike
// doesn't. It ends once the gap is back under HEADING_FAST_EXIT_DEG: lower than the way
// in, or a fast turn would catch up, drop out, fall behind and flap.
export const HEADING_FAST_ERROR_DEG = 12;
export const HEADING_FAST_CONFIRM_READINGS = 3;
export const HEADING_FAST_EXIT_DEG = 4;
// Dead-zone: the heading shown holds still until the filtered one has moved this far
// from it, so a phone held still doesn't shimmer.
export const HEADING_DEAD_ZONE_DEG = 1.5;

// Calibration banner. Jitter is the RMS of the heading's second difference (how much the
// turn rate changes between readings) over the last CALIBRATION_WINDOW_MS. A smooth turn
// has almost none, a confused magnetometer a lot, so turning the phone doesn't trip it.
export const CALIBRATION_WINDOW_MS = 1000;
export const CALIBRATION_SHOW_JITTER_DEG = 6; // above this for SHOW_AFTER_MS: show
export const CALIBRATION_HIDE_JITTER_DEG = 3; // below this for HIDE_AFTER_MS: hide
// Where the platform reports compass accuracy (iOS webkitCompassAccuracy, in degrees;
// negative means invalid; Android reports nothing), it counts too.
export const CALIBRATION_SHOW_ACCURACY_DEG = 25;
export const CALIBRATION_HIDE_ACCURACY_DEG = 15;
export const CALIBRATION_SHOW_AFTER_MS = 2000;
export const CALIBRATION_HIDE_AFTER_MS = 2000;

/**
 * A heading filter. update(rawDeg, nowMs) takes one compass reading (0-360, clockwise
 * from north) and returns { heading, smoothed, fast }: `smoothed` is the low-pass's own
 * value, `heading` the dead-zoned one to show, `fast` whether fast mode is on.
 *
 * The low-pass runs on the heading's sine and cosine, not the angle, so it never takes
 * the long way round through the 359 -> 0 wrap. The first reading is taken as-is.
 */
export const createHeadingFilter = ({
  tauMs = HEADING_TAU_MS,
  fastTauMs = HEADING_FAST_TAU_MS,
  fastErrorDeg = HEADING_FAST_ERROR_DEG,
  fastConfirm = HEADING_FAST_CONFIRM_READINGS,
  fastExitDeg = HEADING_FAST_EXIT_DEG,
  deadZoneDeg = HEADING_DEAD_ZONE_DEG,
} = {}) => {
  let x = null;
  let y = null;
  let lastAt = null;
  let shown = null;
  let streak = 0; // signed: readings in a row beyond fastErrorDeg, by side
  let fast = false;
  const toDeg = (rx, ry) => ((Math.atan2(ry, rx) * 180) / Math.PI + 360) % 360;

  return {
    update(rawDeg, nowMs) {
      const rad = (rawDeg * Math.PI) / 180;
      if (x === null) {
        x = Math.cos(rad);
        y = Math.sin(rad);
        lastAt = nowMs;
        shown = ((rawDeg % 360) + 360) % 360;
        return { heading: shown, smoothed: shown, fast: false };
      }
      const err = angularDifference(rawDeg, toDeg(x, y));
      if (Math.abs(err) >= fastErrorDeg) {
        const side = Math.sign(err);
        streak = Math.sign(streak) === side ? streak + side : side;
      } else {
        streak = 0;
      }
      if (!fast && Math.abs(streak) >= fastConfirm) fast = true;
      else if (fast && Math.abs(err) < fastExitDeg) fast = false;
      // Clamp dt: a long gap (the app in the background) shouldn't make one reading jump
      // the whole way, and two readings at the same millisecond still move a little.
      const dt = Math.min(Math.max(nowMs - lastAt, 1), 200);
      lastAt = nowMs;
      const alpha = 1 - Math.exp(-dt / (fast ? fastTauMs : tauMs));
      x += alpha * (Math.cos(rad) - x);
      y += alpha * (Math.sin(rad) - y);
      const smoothed = toDeg(x, y);
      if (fast || Math.abs(angularDifference(smoothed, shown)) >= deadZoneDeg) shown = smoothed;
      return { heading: shown, smoothed, fast };
    },
  };
};

/**
 * The calibration banner's state. update(rawDeg, nowMs, accuracyDeg) takes each raw
 * compass reading (accuracyDeg null where the platform has none) and returns
 * { show, jitter }. Hysteresis two ways: separate show and hide thresholds, and each
 * must hold for its own time before the banner changes, so it never flickers.
 * Starts hidden: nothing is known to be wrong yet.
 */
export const createCalibrationMonitor = ({
  windowMs = CALIBRATION_WINDOW_MS,
  showJitter = CALIBRATION_SHOW_JITTER_DEG,
  hideJitter = CALIBRATION_HIDE_JITTER_DEG,
  showAccuracy = CALIBRATION_SHOW_ACCURACY_DEG,
  hideAccuracy = CALIBRATION_HIDE_ACCURACY_DEG,
  showAfterMs = CALIBRATION_SHOW_AFTER_MS,
  hideAfterMs = CALIBRATION_HIDE_AFTER_MS,
} = {}) => {
  let show = false;
  let prev = null;
  let prevDelta = null;
  let samples = []; // { at, sq }: squared second differences
  let badSince = null;
  let goodSince = null;

  return {
    update(rawDeg, nowMs, accuracyDeg = null) {
      if (prev !== null) {
        const delta = angularDifference(rawDeg, prev);
        if (prevDelta !== null) {
          const dd = delta - prevDelta;
          samples.push({ at: nowMs, sq: dd * dd });
        }
        prevDelta = delta;
      }
      prev = rawDeg;
      samples = samples.filter((s) => nowMs - s.at <= windowMs);
      const jitter = samples.length
        ? Math.sqrt(samples.reduce((sum, s) => sum + s.sq, 0) / samples.length)
        : 0;

      const hasAccuracy = Number.isFinite(accuracyDeg);
      const accuracyBad = hasAccuracy && (accuracyDeg < 0 || accuracyDeg > showAccuracy);
      const accuracyGood = !hasAccuracy || (accuracyDeg >= 0 && accuracyDeg < hideAccuracy);
      const bad = accuracyBad || jitter > showJitter;
      const good = accuracyGood && jitter < hideJitter;

      badSince = bad ? (badSince ?? nowMs) : null;
      goodSince = good ? (goodSince ?? nowMs) : null;
      if (!show && badSince !== null && nowMs - badSince >= showAfterMs) show = true;
      if (show && goodSince !== null && nowMs - goodSince >= hideAfterMs) show = false;
      return { show, jitter };
    },
  };
};
