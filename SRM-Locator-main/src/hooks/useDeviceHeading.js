import { useState, useCallback, useEffect, useRef } from 'react';
import { angularDifference } from '../utils/geoMath';
import {
  currentScreenAngle,
  deviceQuaternion,
  fusedSensorQuaternion,
  headingFromQuaternion,
  qAngleDeg,
  smoothQuaternion,
} from '../utils/deviceOrientation';
import { createCalibrationMonitor, createHeadingFilter } from '../utils/arHeading';

// deviceorientation fires at roughly the sensor rate (~60Hz on Android). Calling
// setHeading on every event re-renders all of App.jsx — which owns the map, every
// marker and every overlay — 60 times a second. That made the map visibly flicker
// and left panning unresponsive, because google-map-react shallow-compares its
// `options` prop and re-applied the whole style array on each of those renders.
//
// A compass only needs to *look* smooth, so updates are gated two ways: at most
// one state update per MIN_INTERVAL_MS, and only when the bearing actually moved
// MIN_DELTA_DEG. A phone held still therefore triggers no re-renders at all,
// instead of 60 a second.
const MIN_INTERVAL_MS = 100; // <= 10 state updates/sec
const MIN_DELTA_DEG = 1.5;   // ignore sensor jitter below this

// The gate above only limits how often a value is emitted; a noisy reading that
// clears MIN_DELTA_DEG still went straight through as a visible jump. So the raw
// bearing is smoothed first, with an exponential moving average applied per sensor
// event. Lower = steadier but slower to follow a real turn. Needs tuning on a phone:
// try 0.1 (steadier) or 0.35 (more responsive).
export const HEADING_SMOOTHING_ALPHA = 0.2;

// One step of a circular EMA. A bearing can't be averaged as a number (averaging
// 350deg and 10deg gives 180deg, due south), so each bearing becomes a unit vector,
// the EMA runs on the x and y components, and atan2 turns the result back into a
// 0-360 bearing. `vec` is the running average (null before the first reading, which
// is taken as-is); returns the new average and its bearing.
export const smoothHeading = (vec, nextDeg, alpha = HEADING_SMOOTHING_ALPHA) => {
  const rad = (nextDeg * Math.PI) / 180;
  const x = Math.cos(rad);
  const y = Math.sin(rad);
  const out = vec
    ? { x: vec.x + alpha * (x - vec.x), y: vec.y + alpha * (y - vec.y) }
    : { x, y };
  const deg = (Math.atan2(out.y, out.x) * 180) / Math.PI;
  return { vec: out, heading: (deg + 360) % 360 };
};

// The tilt ({ camera: true } only) is gated like the heading: at most one state update
// per MIN_INTERVAL_MS, and only when the smoothed orientation moved this far. Its own
// gate, since a pure tilt doesn't move the heading.
const MIN_TILT_DELTA_DEG = 0.5;

// With `camera: true`, the fused orientation sensor (AbsoluteOrientationSensor, the
// Generic Sensor API's rotation vector: gyroscope, accelerometer and magnetometer fused
// by the OS) is preferred where the WebView offers it. Its readings stand in for the
// deviceorientation events for as long as they keep coming; once none has arrived for
// this long (or it never starts: no API, no permission), the events take over again.
const FUSED_SENSOR_FRESH_MS = 500;
const FUSED_SENSOR_HZ = 60;

// Shortest angular distance between two bearings, accounting for the 360->0 wrap
// (so 359deg -> 1deg reads as 2deg of movement, not 358).
const angularDelta = (a, b) => Math.abs(angularDifference(a, b));

// Extracted from ARCompass.jsx so the AR compass and the live map marker
// (LiveLocationMarker) share one compass implementation. Each caller still gets
// its own DeviceOrientation listener and its own smoothing state.
//
// `camera: true` is for a caller that looks through the phone's camera (AR Scan). The
// same listener then builds the phone's full orientation as a quaternion from alpha,
// beta and gamma together (see deviceOrientation.js), and:
//   - the heading comes from it: where the camera faces when the phone is held up,
//     where the top of the screen points when it lies flat. `360 - alpha` alone jumps by
//     tens of degrees when the phone is upright and rolls a degree. It goes through
//     the same smoothing and gate as before.
//   - with `tilt: true` as well, `tilt` is { q, heading }: the smoothed orientation, as
//     the camera's quaternion, and the heading that orientation has by itself (so a
//     caller can swap in its own heading and keep the tilt). Null until an event carries
//     beta and gamma: no live tilt. Opt-in, since it re-renders the caller up to 10
//     times a second while the phone moves.
// Without them (the map, App.jsx) nothing changes, and no tilt state re-renders anything.
//
// The camera's heading also goes through AR Scan's own filter (arHeading.js: a
// time-based circular low-pass with a dead-zone and a fast mode for real turns) instead
// of the map's fixed per-event EMA, and is watched for calibration trouble:
//   - `calibrationNeeded`: true while the compass looks like it needs a figure-8
//     (createCalibrationMonitor; it changes state only after holding for ~2 s).
//   - `diagnosticsRef.current`: { raw, smoothed, heading, accuracy, jitter, fast, source }
//     for AR Scan's debug overlay. `raw` is the unfiltered heading; `accuracy` the
//     platform's compass accuracy in degrees, null where it has none (Android);
//     `source` 'fused-sensor', 'orientation-event' or 'ios-compass'.
// All of these headings are magnetic: the caller adds the declination.
export function useDeviceHeading({ camera = false, tilt: wantTilt = false } = {}) {
  const [heading, setHeading] = useState(0);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  // True once a real absolute reading has arrived. permissionsGranted only means the
  // listener is attached: on a device without a compass (or a desktop browser) no event
  // ever comes and `heading` stays 0, which would pass for "facing north".
  const [hasReading, setHasReading] = useState(false);
  const [tilt, setTilt] = useState(null);

  // Always holds the newest smoothed bearing, untouched by the throttle above, so
  // telemetry emits report the true current heading rather than whatever value
  // last made it past the render gate.
  const headingRef = useRef(0);
  const smoothVecRef = useRef(null);
  const lastEmitAtRef = useRef(0);
  const lastEmitValRef = useRef(null);
  const tiltQRef = useRef(null);
  const lastTiltEmitAtRef = useRef(0);
  const lastTiltEmitRef = useRef(null);
  const [calibrationNeeded, setCalibrationNeeded] = useState(false);
  const filterRef = useRef(null);
  const calibrationRef = useRef(null);
  const diagnosticsRef = useRef(null);
  const fusedSensorRef = useRef(null);
  const lastFusedAtRef = useRef(0);

  // useCallback with empty deps keeps this function's identity stable across
  // renders (setHeading is guaranteed stable by React) so addEventListener/
  // removeEventListener always operate on the same reference — otherwise
  // removeEventListener silently no-ops against a stale closure from an
  // earlier render and the listener leaks past unmount.
  // One reading, whatever it came from: `next` the raw heading, `q` the camera
  // orientation when known, `accuracy` in degrees or null.
  const ingest = useCallback((next, q, accuracy, source) => {
    const now = Date.now();
    if (q && wantTilt) {
      tiltQRef.current = smoothQuaternion(tiltQRef.current, q, HEADING_SMOOTHING_ALPHA);
      const moved = lastTiltEmitRef.current === null || qAngleDeg(tiltQRef.current, lastTiltEmitRef.current) >= MIN_TILT_DELTA_DEG;
      if (moved && now - lastTiltEmitAtRef.current >= MIN_INTERVAL_MS) {
        lastTiltEmitAtRef.current = now;
        lastTiltEmitRef.current = tiltQRef.current;
        setTilt({ q: tiltQRef.current, heading: headingFromQuaternion(tiltQRef.current) });
      }
    }

    const raw = next;
    if (camera) {
      filterRef.current ??= createHeadingFilter();
      calibrationRef.current ??= createCalibrationMonitor();
      const filtered = filterRef.current.update(raw, now);
      const calibration = calibrationRef.current.update(raw, now, accuracy);
      next = filtered.heading;
      diagnosticsRef.current = {
        raw, smoothed: filtered.smoothed, heading: next, accuracy,
        jitter: calibration.jitter, fast: filtered.fast, source,
      };
      setCalibrationNeeded(calibration.show); // bails out unless it changed
    } else {
      const smoothed = smoothHeading(smoothVecRef.current, next);
      smoothVecRef.current = smoothed.vec;
      next = smoothed.heading;
    }
    headingRef.current = next;
    setHasReading(true); // a no-op re-render after the first

    if (now - lastEmitAtRef.current < MIN_INTERVAL_MS) return;
    if (lastEmitValRef.current !== null && angularDelta(next, lastEmitValRef.current) < MIN_DELTA_DEG) return;

    lastEmitAtRef.current = now;
    lastEmitValRef.current = next;
    setHeading(next);
  }, [camera, wantTilt]);

  const handleOrientation = useCallback((event) => {
    // While the fused sensor is speaking its readings win: the same orientation, without
    // the round trip through Euler angles.
    if (fusedSensorRef.current && Date.now() - lastFusedAtRef.current < FUSED_SENSOR_FRESH_MS) return;
    const hasTilt = camera && Number.isFinite(event.beta) && Number.isFinite(event.gamma);
    let next = null;
    let q = null;
    let accuracy = null;
    let source = 'orientation-event';
    if (typeof event.webkitCompassHeading === 'number') {
      // iOS absolute (0 is a valid heading — due north — so this must not be a truthy check).
      // Its alpha is relative, which the tilt doesn't mind: callers swap its heading out.
      next = event.webkitCompassHeading;
      source = 'ios-compass';
      if (Number.isFinite(event.webkitCompassAccuracy)) accuracy = event.webkitCompassAccuracy;
      if (hasTilt) q = deviceQuaternion(event.alpha ?? 0, event.beta, event.gamma, currentScreenAngle());
    } else if (event.absolute && event.alpha !== null) {
      // Android absolute
      if (hasTilt) {
        q = deviceQuaternion(event.alpha, event.beta, event.gamma, currentScreenAngle());
        next = headingFromQuaternion(q);
      } else {
        next = 360 - event.alpha;
      }
    }
    // If it's a relative event (event.absolute is false), ignore it.
    // Otherwise it overwrites the absolute heading with 0!
    if (next === null || Number.isNaN(next)) return;
    ingest(next, q, accuracy, source);
  }, [camera, ingest]);

  // Camera only: start the fused sensor, if this WebView has one. Any failure (no API,
  // permission refused, no hardware) just leaves the deviceorientation events in charge.
  const startFusedSensor = useCallback(() => {
    if (!camera || fusedSensorRef.current || typeof window === 'undefined') return;
    const Sensor = window.AbsoluteOrientationSensor;
    if (typeof Sensor !== 'function') return;
    try {
      const sensor = new Sensor({ frequency: FUSED_SENSOR_HZ, referenceFrame: 'device' });
      sensor.addEventListener('reading', () => {
        const raw = sensor.quaternion;
        if (!raw || raw.length !== 4) return;
        const q = fusedSensorQuaternion(Array.from(raw), currentScreenAngle());
        const next = headingFromQuaternion(q);
        if (Number.isNaN(next)) return;
        lastFusedAtRef.current = Date.now();
        ingest(next, q, null, 'fused-sensor');
      });
      sensor.addEventListener('error', (e) => {
        console.warn('[SYS_AR] Fused orientation sensor unavailable, using deviceorientation.', e?.error?.name);
        sensor.stop();
        if (fusedSensorRef.current === sensor) fusedSensorRef.current = null;
      });
      sensor.start();
      fusedSensorRef.current = sensor;
    } catch (err) {
      console.warn('[SYS_AR] Fused orientation sensor unavailable, using deviceorientation.', err?.name);
    }
  }, [camera, ingest]);

  // iOS 13+ requires this to run inside a user gesture (a click handler),
  // so callers on iOS must invoke it from one (e.g. ARCompass's "GRANT_ACCESS"
  // button). On Android there's no such gate — safe to call on mount.
  const requestHeadingPermission = useCallback(async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        if (permissionState === 'granted') {
          window.addEventListener('deviceorientationabsolute', handleOrientation, true);
          window.addEventListener('deviceorientation', handleOrientation, true);
          startFusedSensor();
          setPermissionsGranted(true);
          return true;
        }
        return false;
      } catch (err) {
        console.error(err);
        return false;
      }
    } else {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
      startFusedSensor();
      setPermissionsGranted(true);
      return true;
    }
  }, [handleOrientation, startFusedSensor]);

  useEffect(() => {
    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
      fusedSensorRef.current?.stop();
      fusedSensorRef.current = null;
    };
  }, [handleOrientation]);

  return { heading, headingRef, tilt, permissionsGranted, hasReading, requestHeadingPermission, calibrationNeeded, diagnosticsRef };
}
