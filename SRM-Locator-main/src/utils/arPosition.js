// AR Scan's own view of where the phone is, and how distances are shown. Pure, so the
// filter and the rounding are tested with made-up fixes. useArPosition feeds it.
//
// --- Tuning. Check these on a real walk with the debug overlay (long-press the
// AR_TRACKER title), which shows each fix's reported accuracy. ---

// Fixes reporting worse accuracy than this (metres, the 68% radius the browser gives)
// are ignored outright.
export const GPS_MAX_ACCURACY_M = 30;
// How fast the phone is assumed able to move, for the filter: the position's uncertainty
// grows by this much per second between fixes. Walking pace; higher follows a run or a
// cycle faster, lower is steadier.
export const GPS_PROCESS_SPEED_MPS = 1.5;
// The distance shown doesn't change until it has moved at least this much (metres).
export const DISTANCE_DEADBAND_M = 2;

/**
 * A position filter: a Kalman filter on latitude and longitude with one shared variance,
 * in square metres. update({ lat, lng, accuracy, timestamp }) takes one geolocation fix
 * (accuracy in metres, timestamp in ms) and returns { accepted, position }: whether the
 * fix was used, and the filtered { lat, lng } (null before any fix has been accepted).
 * A fix less accurate than `maxAccuracy`, or without an accuracy, is rejected. The first
 * accepted fix is taken as-is; each later one is blended in by how its accuracy compares
 * with the estimate's, so a sharp fix pulls hard and a vague one barely moves it.
 */
export const createPositionFilter = ({
  maxAccuracy = GPS_MAX_ACCURACY_M,
  processSpeed = GPS_PROCESS_SPEED_MPS,
} = {}) => {
  let position = null;
  let variance = 0;
  let lastAt = 0;
  return {
    update({ lat, lng, accuracy, timestamp }) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(accuracy > 0) || accuracy > maxAccuracy) {
        return { accepted: false, position };
      }
      const r = accuracy * accuracy;
      if (!position) {
        position = { lat, lng };
        variance = r;
        lastAt = timestamp;
        return { accepted: true, position };
      }
      const dt = Math.max((timestamp - lastAt) / 1000, 0);
      lastAt = timestamp;
      const predicted = variance + (processSpeed * dt) ** 2;
      const k = predicted / (predicted + r);
      position = { lat: position.lat + k * (lat - position.lat), lng: position.lng + k * (lng - position.lng) };
      variance = (1 - k) * predicted;
      return { accepted: true, position };
    },
  };
};

// The distance to show, given what is showing now (`shown`, null at first) and the new
// whole-metre distance: unchanged until it has moved `band` metres or more.
export const stickyDistance = (shown, next, band = DISTANCE_DEADBAND_M) =>
  shown === null || shown === undefined || !Number.isFinite(next) || Math.abs(next - shown) >= band ? next : shown;

// One rounding rule for every distance AR Scan shows: whole metres under a kilometre,
// tenths of a kilometre from there. `sep` goes between the number and the unit.
export const formatArDistance = (meters, sep = ' ') => {
  const m = Math.max(0, Math.round(meters || 0));
  return m >= 1000 ? `${(m / 1000).toFixed(1)}${sep}KM` : `${m}${sep}M`;
};
