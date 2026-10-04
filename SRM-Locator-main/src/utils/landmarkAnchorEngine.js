import { angularDifference, calculateBearing, calculateDistanceMeters } from './geoMath';
import { toLocalMeters } from './arRoadLine';
import { AR_CAMERA_HEIGHT_M, verticalFovDeg } from './arCamera';
import { qConjugate, qFromAxisAngle, qFromEulerYXZ, qMultiply, qRotate } from './deviceOrientation';
import { formatArDistance } from './arPosition';

// The Landmark Anchor Engine: where each AR Scan tag goes on screen so it sits on the
// real thing in the camera view. Pure functions and one small class, no UI: ARCompass
// feeds it the position, the camera's orientation and field of view, and renders what it
// returns (ARLandmarkLayer). The heading it is given is already smoothed and corrected to
// true north (useDeviceHeading + declination + useLiveHeading); nothing here touches the
// sensors.
//
// Projection: a pinhole camera, the same one the 3D road is drawn through (arCamera.js).
// Each landmark is a point HEIGHT_ANCHOR_RATIO of the way up the building, turned into the
// camera's frame by the phone's full orientation (heading, pitch and roll together, as a
// quaternion), then divided by its depth. So tilting the phone moves the tag with the
// building, and roll is already in the position: no separate layer rotation.
//
// --- Tuning. Every value marked (campus) needs checking on a walk with the debug overlay
// (long-press the AR_TRACKER title). ---

// Landmarks further than this get no tag (the destination always does).
export const MAX_RANGE_M = 500;
// Tags fade from full strength at FADE_START_M to MIN_OPACITY at MAX_RANGE_M, and shrink
// from full size at SCALE_NEAR_M to MIN_SCALE at MAX_RANGE_M. (campus)
export const FADE_START_M = 250;
export const MIN_OPACITY = 0.45;
export const SCALE_NEAR_M = 60;
export const MIN_SCALE = 0.8;
// How high the phone is held above the ground: the camera's height, shared with the 3D
// road so tags and road agree. (campus)
export const PHONE_HEIGHT_M = AR_CAMERA_HEIGHT_M;
// A building with no measured height (arLandmarks.js) is taken to be this tall.
export const DEFAULT_BUILDING_HEIGHT_M = 15;
// A squad member's tag is anchored as if they were a "building" this tall.
export const PERSON_HEIGHT_M = 1.7;
// The tag points at this fraction of a building's height. (campus)
export const HEIGHT_ANCHOR_RATIO = 0.6;
// Tag easing: the time constant of each tag's glide to its new spot, in ms (time-based,
// so frame-rate independent). A change bigger than SNAP_THRESHOLD_DEG of view (a fast
// turn, a tag appearing) jumps straight there instead. (campus)
export const SMOOTHING = 90;
export const SNAP_THRESHOLD_DEG = 8;
// The focused tag (nearest the centre) moves to another only after that one has been
// nearer for this long.
export const LOCK_HOLD_MS = 400;
// One-tap ALIGN: the correction it may apply, in total, and the conditions for trusting
// it: a GPS fix at least this good, and a landmark far enough away that the fix's error
// can swing its bearing by no more than ALIGN_MAX_BEARING_ERROR_DEG.
export const MAX_ALIGN_OFFSET_DEG = 20;
export const GPS_MIN_ACCURACY_M = 15;
export const ALIGN_MAX_BEARING_ERROR_DEG = 5;
// Distances and bearings are worked out again only once the phone has moved this far.
export const POSITION_EPSILON_M = 2;
// Occlusion: a landmark is "occluded" (dimmed, not removed) when one at most this
// fraction of its distance away covers its bearing and stands taller in view than its
// anchor. A building with no footprint is taken to be this wide either side. (campus)
export const OCCLUSION_NEAR_RATIO = 0.5;
export const OCCLUDED_OPACITY = 0.35;
export const DEFAULT_HALF_WIDTH_M = 15;
// The camera lens's field of view across the long side of its picture, in degrees.
// TODO: the web exposes no lens data; reading it needs a native camera plugin (an APK
// release). Until then a typical phone main camera; the crop to the screen is measured
// live (effectiveHorizontalFov). (campus: line up two buildings a known angle apart)
export const CAMERA_LONG_SIDE_FOV_DEG = 68;
// Landmarks this far past either edge of the view get an edge tag, with an arrow. The
// destination always does.
export const EDGE_TAG_MAX_BEYOND_DEG = 25;
// Clutter cap: in-view landmarks first, nearest first, then edge tags.
export const MAX_VISIBLE_TAGS = 6;
// Label size estimates for the overlap layout, in CSS pixels at scale 1. ARTag's text is
// 10px with wide tracking; these only decide overlaps, so generous beats tight.
export const TAG_CHAR_PX = 8.5;
export const TAG_CHROME_PX = 40;   // padding, border, icon and gaps
export const TAG_EDGE_ARROW_PX = 14;
export const TAG_LABEL_HEIGHT_PX = 24;
export const TAG_TICK_PX = 12;     // the line from a label down to its point
export const TAG_GAP_PX = 6;       // the least space between two labels
export const TAG_ROW_GAP_PX = TAG_GAP_PX; // between stacked rows (no less, or a row never fits)
export const TAG_SCREEN_MARGIN_PX = 8;
export const TAG_MAX_ROWS = 3;
// A crowded name is cut to this, plus an ellipsis. Keep it under what 40vw already shows
// on a narrow phone (about 9 characters at 412 px), or cutting it gains nothing.
export const TAG_SHORT_NAME_CHARS = 7;
export const TAG_MAX_WIDTH_FRACTION = 0.4; // ARTag's max-w-[40vw]

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

// ---------------------------------------------------------------------------------------
// Camera

/**
 * The horizontal field of view actually on screen, in degrees. The video fills the screen
 * with object-cover, which crops the camera's picture to the screen's shape, so the view
 * is narrower than the lens's. `videoWidth`/`videoHeight` are the stream's; without them
 * (no camera yet) a 4:3 stream is assumed, in the screen's orientation. `lensFovDeg` is
 * across the stream's long side.
 */
export const effectiveHorizontalFov = ({ videoWidth, videoHeight, screenWidth, screenHeight, lensFovDeg = CAMERA_LONG_SIDE_FOV_DEG }) => {
  if (!(screenWidth > 0) || !(screenHeight > 0)) return lensFovDeg;
  let vw = videoWidth;
  let vh = videoHeight;
  if (!(vw > 0) || !(vh > 0)) {
    [vw, vh] = screenWidth <= screenHeight ? [3, 4] : [4, 3];
  }
  const tanHalfStream = Math.tan(rad(lensFovDeg) / 2) * (vw / Math.max(vw, vh));
  const scale = Math.max(screenWidth / vw, screenHeight / vh);
  const visible = Math.min(screenWidth / (vw * scale), 1);
  return deg(2 * Math.atan(tanHalfStream * visible));
};

/**
 * A camera orientation [x, y, z, w] from angles: facing `headingDeg` (true, clockwise from
 * north), `pitchDeg` up from level, `rollDeg` clockwise as the user sees the screen.
 * (World axes as three.js: x east, y up, z south; the camera looks down its -z.)
 */
export const orientationFromAngles = ({ headingDeg = 0, pitchDeg = 0, rollDeg = 0 }) =>
  qFromEulerYXZ(rad(pitchDeg), -rad(headingDeg), -rad(rollDeg));

/** The heading, pitch and roll (degrees, as orientationFromAngles takes them) of `q`. */
export const anglesFromOrientation = (q) => {
  const f = qRotate(q, [0, 0, -1]);
  const r = qRotate(q, [1, 0, 0]);
  const u = qRotate(q, [0, 1, 0]);
  return {
    headingDeg: ((deg(Math.atan2(f[0], -f[2])) % 360) + 360) % 360,
    pitchDeg: deg(Math.asin(clamp(f[1], -1, 1))),
    rollDeg: deg(Math.atan2(-r[1], u[1])),
  };
};

/**
 * `q` with an ALIGN correction applied: turned `headingOffsetDeg` clockwise about the
 * vertical, and tipped `pitchOffsetDeg` up about the camera's own horizontal axis.
 */
export const applyAlignment = (q, { headingOffsetDeg = 0, pitchOffsetDeg = 0 } = {}) =>
  qMultiply(qFromAxisAngle([0, 1, 0], -rad(headingOffsetDeg)), qMultiply(q, qFromAxisAngle([1, 0, 0], rad(pitchOffsetDeg))));

/**
 * A point `east`, `north` metres from the phone and `up` metres above the camera, in the
 * camera's frame: { x (right), y (up), depth (ahead), azDeg, elDeg }. azDeg is its angle
 * right of the camera's axis (-180..180, so behind is beyond +-90); elDeg its angle above
 * the axis's horizontal plane.
 */
export const toCameraFrame = (q, east, north, up) => {
  const [x, y, z] = qRotate(qConjugate(q), [east, up, -north]);
  const depth = -z;
  return { x, y, depth, azDeg: deg(Math.atan2(x, depth)), elDeg: deg(Math.atan2(y, Math.hypot(x, depth))) };
};

// ---------------------------------------------------------------------------------------
// Geometry per landmark

// Half the angle a landmark spans from `origin`, in degrees: from its footprint (each
// corner's bearing against the centre's) when it has one, else DEFAULT_HALF_WIDTH_M.
export const angularHalfWidth = (origin, landmark, distanceM) => {
  const centre = calculateBearing(origin.lat, origin.lng, landmark.lat, landmark.lng);
  if (Array.isArray(landmark.footprint) && landmark.footprint.length >= 3) {
    let half = 0;
    for (const [lat, lng] of landmark.footprint) {
      half = Math.max(half, Math.abs(angularDifference(calculateBearing(origin.lat, origin.lng, lat, lng), centre)));
    }
    // Standing inside or right beside it, the footprint can span everything.
    return Math.min(half, 90);
  }
  return deg(Math.atan2(DEFAULT_HALF_WIDTH_M, Math.max(distanceM, 1)));
};

/**
 * Which landmarks are occluded. `items` are [{ id, distanceM, bearingDeg, halfWidthDeg,
 * topElDeg, anchorElDeg }]; returns the Set of ids hidden behind a much nearer one: within
 * OCCLUSION_NEAR_RATIO of the distance, covering the bearing, and rising above the anchor.
 */
export const findOccluded = (items, nearRatio = OCCLUSION_NEAR_RATIO) => {
  const occluded = new Set();
  for (const far of items) {
    for (const near of items) {
      if (near === far || near.distanceM > far.distanceM * nearRatio) continue;
      if (Math.abs(angularDifference(far.bearingDeg, near.bearingDeg)) > near.halfWidthDeg) continue;
      if (near.topElDeg < far.anchorElDeg) continue;
      occluded.add(far.id);
      break;
    }
  }
  return occluded;
};

// ---------------------------------------------------------------------------------------
// Layout

const labelWidthPx = (name, distanceText, edge, screenWidthPx) => {
  const nameCap = Math.max(TAG_MAX_WIDTH_FRACTION * screenWidthPx - TAG_CHROME_PX - distanceText.length * TAG_CHAR_PX, TAG_CHAR_PX * 3);
  return TAG_CHROME_PX + Math.min(name.length * TAG_CHAR_PX, nameCap) + distanceText.length * TAG_CHAR_PX
    + (edge ? TAG_EDGE_ARROW_PX : 0);
};

export const shortenName = (name, chars = TAG_SHORT_NAME_CHARS) =>
  (name.length > chars ? `${name.slice(0, chars).trimEnd()}…` : name);

/**
 * Lays tags out so none overlaps another or leaves the screen. `tags` are
 * [{ id, isTarget, name, distanceM, distanceText, offscreenSide, x, y, scale }] in pixels,
 * (x, y) the point the tag's tick should touch.
 *
 * The destination goes first (onto an empty screen, so it always fits); then the rest,
 * nearest first, so the nearer of two overlapping tags keeps its place. A label that hits
 * one already placed shifts up to just clear it (its tick stretched down to its point),
 * at most TAG_MAX_ROWS - 1 times (`row` counts the shifts); with no room, its name is cut
 * short and tried again, and failing that it is left out. Every label stays
 * TAG_SCREEN_MARGIN_PX inside the screen.
 *
 * Returns the placed tags with `labelName`, `row`, `tickPx`, and x, y moved where
 * clamping needed it, in drawing order: farthest first and the destination last, so the
 * nearer one is on top; within that, higher rows first, so a long tick passes behind the
 * labels below it.
 */
export const layoutTags = (tags, { width: W, height: H }) => {
  if (!(W > 0) || !(H > 0)) return [];
  const order = [...tags].sort((a, b) => (b.isTarget - a.isTarget) || a.distanceM - b.distanceM);
  const placed = [];
  const boxes = [];
  const hits = (box) => boxes.filter((b) =>
    !(box.left >= b.right + TAG_GAP_PX || box.right <= b.left - TAG_GAP_PX
      || box.top >= b.bottom + TAG_GAP_PX || box.bottom <= b.top - TAG_GAP_PX));

  const tryPlace = (t, labelName) => {
    const s = t.scale ?? 1;
    const w = Math.min(labelWidthPx(labelName, t.distanceText, t.offscreenSide, W) * s, W - 2 * TAG_SCREEN_MARGIN_PX);
    const h = TAG_LABEL_HEIGHT_PX * s;
    const cx = clamp(t.x, TAG_SCREEN_MARGIN_PX + w / 2, W - TAG_SCREEN_MARGIN_PX - w / 2);
    const anchorY = clamp(t.y, TAG_SCREEN_MARGIN_PX + h + TAG_TICK_PX, H - TAG_SCREEN_MARGIN_PX);
    let bottom = anchorY - TAG_TICK_PX;
    for (let row = 0; row < TAG_MAX_ROWS; row++) {
      const box = { left: cx - w / 2, right: cx + w / 2, top: bottom - h, bottom };
      if (box.top < TAG_SCREEN_MARGIN_PX) break;
      const blocking = hits(box);
      if (!blocking.length) {
        boxes.push(box);
        placed.push({ ...t, labelName, row, tickPx: anchorY - bottom, x: cx, y: anchorY });
        return true;
      }
      // Up past the highest label in the way, TAG_ROW_GAP_PX clear of it.
      bottom = Math.min(...blocking.map((b) => b.top)) - TAG_ROW_GAP_PX;
    }
    return false;
  };

  for (const t of order) {
    if (tryPlace(t, t.name)) continue;
    const short = shortenName(t.name);
    if (short !== t.name) tryPlace(t, short);
  }
  return placed.sort((a, b) => (a.isTarget - b.isTarget) || b.distanceM - a.distanceM || b.row - a.row);
};

/**
 * Which tag is focused: the one nearest the centre of the view, with hysteresis.
 * update(candidates, nowMs) takes [{ id, offset }] (offset: distance from the centre) and
 * returns { id, pendingMs }: the focused id (null with no candidates), and, while another
 * is nearer but hasn't been for `holdMs` yet, how long until it would take over, else
 * null. A focused tag that has left the view is replaced at once.
 */
export const createFocusTracker = (holdMs = LOCK_HOLD_MS) => {
  let current = null;
  let challenger = null;
  let since = 0;
  return {
    update(candidates, nowMs) {
      if (!candidates.length) {
        current = null;
        challenger = null;
        return { id: null, pendingMs: null };
      }
      const best = candidates.reduce((a, b) => (b.offset < a.offset ? b : a));
      if (current === null || !candidates.some((c) => c.id === current)) {
        current = best.id;
        challenger = null;
      } else if (best.id === current) {
        challenger = null;
      } else {
        if (challenger !== best.id) {
          challenger = best.id;
          since = nowMs;
        }
        if (nowMs - since >= holdMs) {
          current = best.id;
          challenger = null;
        }
      }
      return { id: current, pendingMs: challenger === null ? null : Math.max(holdMs - (nowMs - since), 0) };
    },
  };
};

// ---------------------------------------------------------------------------------------
// Alignment

export const NO_ALIGNMENT = Object.freeze({ headingOffsetDeg: 0, pitchOffsetDeg: 0 });

export const clampAlignment = ({ headingOffsetDeg = 0, pitchOffsetDeg = 0 } = {}, max = MAX_ALIGN_OFFSET_DEG) => ({
  headingOffsetDeg: clamp(Number.isFinite(headingOffsetDeg) ? headingOffsetDeg : 0, -max, max),
  pitchOffsetDeg: clamp(Number.isFinite(pitchOffsetDeg) ? pitchOffsetDeg : 0, -max, max),
});

/**
 * One tap of ALIGN. The user has the real `tag` (a frame tag of a building, from the
 * engine: `building` true, which a destination that is a building is too) in the middle
 * of the view; the engine thinks it is at (camAzDeg, camElDeg) off
 * centre. So the camera actually points that much further round and up than assumed:
 * expected - observed. Returns { ok: true, alignment } (the new total, `current` plus
 * the correction, clamped to +-MAX_ALIGN_OFFSET_DEG), or { ok: false, reason }:
 *   'no-landmark'  no building tag in view to align to
 *   'gps'          no fix, or one worse than GPS_MIN_ACCURACY_M
 *   'too-close'    the fix's error could swing this landmark's bearing too far
 *   'not-centred'  the correction itself would exceed MAX_ALIGN_OFFSET_DEG (the user
 *                  almost certainly isn't looking at that landmark)
 */
export const computeAlignment = ({ tag, accuracyM, current = NO_ALIGNMENT }) => {
  if (!tag || !tag.building || !tag.visible) return { ok: false, reason: 'no-landmark' };
  if (!Number.isFinite(accuracyM) || accuracyM > GPS_MIN_ACCURACY_M) return { ok: false, reason: 'gps' };
  if (deg(Math.atan2(accuracyM, Math.max(tag.distanceM, 1))) > ALIGN_MAX_BEARING_ERROR_DEG) return { ok: false, reason: 'too-close' };
  if (Math.abs(tag.camAzDeg) > MAX_ALIGN_OFFSET_DEG || Math.abs(tag.camElDeg) > MAX_ALIGN_OFFSET_DEG) {
    return { ok: false, reason: 'not-centred' };
  }
  return {
    ok: true,
    alignment: clampAlignment({
      headingOffsetDeg: current.headingOffsetDeg + tag.camAzDeg,
      pitchOffsetDeg: current.pitchOffsetDeg + tag.camElDeg,
    }),
  };
};

// The alignment, kept for the app session (sessionStorage: until the app is closed).
// `storage` is passed in so this stays testable; any storage failure is ignored.
export const ALIGNMENT_STORAGE_KEY = 'locus.arAlignment';
export const loadAlignment = (storage) => {
  try {
    const raw = storage?.getItem(ALIGNMENT_STORAGE_KEY);
    return raw ? clampAlignment(JSON.parse(raw)) : NO_ALIGNMENT;
  } catch {
    return NO_ALIGNMENT;
  }
};
export const saveAlignment = (storage, alignment) => {
  try {
    if (alignment.headingOffsetDeg === 0 && alignment.pitchOffsetDeg === 0) storage?.removeItem(ALIGNMENT_STORAGE_KEY);
    else storage?.setItem(ALIGNMENT_STORAGE_KEY, JSON.stringify(alignment));
  } catch {
    // Private mode, quota, no storage: the alignment just lasts until AR Scan closes.
  }
};

// ---------------------------------------------------------------------------------------
// The engine

/**
 * Usage: setLandmarks(list) whenever the list changes; setPosition(fix) on each fix;
 * frame(view) on each animation frame. Landmarks are [{ id, kind ('building' | 'member'
 * | 'target'), name, lat, lng, heightM (null: the default for its kind),
 * anchorOffsetM ({ east, north } or null), footprint, building (a 'target' that is a
 * building, so ALIGN can use it) }].
 *
 * frame({ q, hFovDeg, width, height, nowMs, targetId }) takes the camera orientation
 * (already aligned: applyAlignment), the horizontal field of view on screen, the viewport
 * in pixels, a clock in ms and the destination's landmark id. Instead of `q` it also takes
 * { headingDeg, pitchDeg, rollDeg }. It returns { tags, settled, pendingMs, focusId,
 * hFovDeg, vFovDeg, headingDeg, pitchDeg, rollDeg }, where each tag is
 *   { id, kind, building, name, distanceM, distanceText, bearingDeg, screenX, screenY, visible,
 *     offscreenSide ('left' | 'right' | null), scale, opacity, occluded, priority,
 *     focused, labelName, row, tickPx, camAzDeg, camElDeg }
 * in drawing order (`priority` rises toward the top). screenX/screenY are the eased
 * pixel position of the point the tag's tick touches (its label centred above it).
 * `settled` is false while any tag is still gliding, and `pendingMs` (or null) when a
 * focus change is due: call frame again until both say there is nothing left to do.
 */
export class LandmarkAnchorEngine {
  constructor() {
    this.landmarks = [];
    this.origin = null;      // the latest fix
    this.anchorOrigin = null; // where distances and bearings were last worked out from
    this.geometry = new Map();
    this.shown = new Map();   // id -> eased { x, y, tickPx }
    this.focus = createFocusTracker();
    this.lastFrameAt = null;
  }

  setLandmarks(landmarks) {
    this.landmarks = Array.isArray(landmarks) ? landmarks.filter((l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lng)) : [];
  }

  setPosition(position) {
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
    this.origin = { lat: position.lat, lng: position.lng };
    if (!this.anchorOrigin || calculateDistanceMeters(this.anchorOrigin.lat, this.anchorOrigin.lng, position.lat, position.lng) >= POSITION_EPSILON_M) {
      this.anchorOrigin = this.origin;
      this.geometry.clear();
    }
  }

  // Distance, bearing and local offset of one landmark, kept until the phone moves
  // POSITION_EPSILON_M or the landmark itself moves (a squad member walking).
  geometryOf(l) {
    const cached = this.geometry.get(l.id);
    if (cached && cached.lat === l.lat && cached.lng === l.lng) return cached;
    const o = this.anchorOrigin;
    const { x: east, y: north } = toLocalMeters(o, l);
    const distanceM = calculateDistanceMeters(o.lat, o.lng, l.lat, l.lng);
    const g = {
      lat: l.lat,
      lng: l.lng,
      east: east + (l.anchorOffsetM?.east ?? 0),
      north: north + (l.anchorOffsetM?.north ?? 0),
      distanceM,
      bearingDeg: calculateBearing(o.lat, o.lng, l.lat, l.lng),
      halfWidthDeg: angularHalfWidth(o, l, distanceM),
    };
    this.geometry.set(l.id, g);
    return g;
  }

  frame({ q, headingDeg, pitchDeg, rollDeg, hFovDeg, width, height, nowMs = 0, targetId = null }) {
    const orientation = q ?? orientationFromAngles({ headingDeg, pitchDeg, rollDeg });
    const angles = anglesFromOrientation(orientation);
    const vFovDeg = width > 0 && height > 0 ? verticalFovDeg(width, height, hFovDeg) : NaN;
    const empty = { tags: [], settled: true, pendingMs: null, focusId: null, hFovDeg, vFovDeg, ...angles };
    if (!this.anchorOrigin || !(width > 0) || !(height > 0) || !(hFovDeg > 0)) return empty;
    const tanH = Math.tan(rad(hFovDeg) / 2);
    const tanV = Math.tan(rad(vFovDeg) / 2);

    const items = [];
    for (const l of this.landmarks) {
      const g = this.geometryOf(l);
      if (!(g.distanceM > 0)) continue;
      const isTarget = l.id === targetId;
      if (!isTarget && g.distanceM > MAX_RANGE_M) continue;
      const heightM = Number.isFinite(l.heightM) ? l.heightM
        : l.kind === 'member' ? PERSON_HEIGHT_M
          : l.kind === 'building' ? DEFAULT_BUILDING_HEIGHT_M : 0;
      const anchorUp = heightM * HEIGHT_ANCHOR_RATIO - PHONE_HEIGHT_M;
      const cam = toCameraFrame(orientation, g.east, g.north, anchorUp);
      const nx = cam.depth > 0.1 ? cam.x / (cam.depth * tanH) : Infinity;
      const visible = Math.abs(nx) < 1;
      let x;
      let y;
      let offscreenSide = null;
      if (visible) {
        x = (width / 2) * (1 + nx);
        y = (height / 2) * (1 - cam.y / (cam.depth * tanV));
      } else {
        if (!isTarget && Math.abs(cam.azDeg) - hFovDeg / 2 > EDGE_TAG_MAX_BEYOND_DEG) continue;
        offscreenSide = cam.azDeg < 0 ? 'left' : 'right';
        x = offscreenSide === 'left' ? 0 : width;
        y = (height / 2) * (1 - Math.tan(rad(clamp(cam.elDeg, -80, 80))) / tanV);
      }
      const far = (g.distanceM - FADE_START_M) / (MAX_RANGE_M - FADE_START_M);
      items.push({
        id: l.id,
        kind: l.kind,
        building: l.kind === 'building' || Boolean(l.building),
        isTarget,
        name: l.name,
        distanceM: g.distanceM,
        distanceText: formatArDistance(g.distanceM),
        bearingDeg: g.bearingDeg,
        halfWidthDeg: g.halfWidthDeg,
        topElDeg: deg(Math.atan2(heightM - PHONE_HEIGHT_M, g.distanceM)),
        anchorElDeg: deg(Math.atan2(anchorUp, g.distanceM)),
        x,
        y,
        visible,
        offscreenSide,
        camAzDeg: cam.azDeg,
        camElDeg: cam.elDeg,
        opacity: lerp(1, MIN_OPACITY, far),
        scale: lerp(1, MIN_SCALE, (g.distanceM - SCALE_NEAR_M) / (MAX_RANGE_M - SCALE_NEAR_M)),
      });
    }

    const occluded = findOccluded(items);
    for (const it of items) {
      it.occluded = occluded.has(it.id);
      // Dimmed, never removed; the destination stays readable.
      if (it.occluded && !it.isTarget) it.opacity *= OCCLUDED_OPACITY;
    }

    const byDistance = (a, b) => a.distanceM - b.distanceM;
    const others = items.filter((it) => !it.isTarget);
    const kept = [
      ...items.filter((it) => it.isTarget),
      ...[...others.filter((it) => it.visible).sort(byDistance), ...others.filter((it) => !it.visible).sort(byDistance)]
        .slice(0, MAX_VISIBLE_TAGS),
    ];

    const { id: focusId, pendingMs } = this.focus.update(
      kept.filter((it) => it.visible).map((it) => ({ id: it.id, offset: Math.abs(it.x - width / 2) })),
      nowMs,
    );

    const placed = layoutTags(kept, { width, height });

    // Easing toward the laid-out spots, by elapsed time; a big jump snaps.
    const dt = this.lastFrameAt === null ? 0 : clamp(nowMs - this.lastFrameAt, 0, 100);
    this.lastFrameAt = nowMs;
    const alpha = 1 - Math.exp(-dt / SMOOTHING);
    const snapPx = ((width / 2) / tanH) * Math.tan(rad(SNAP_THRESHOLD_DEG));
    const next = new Map();
    let settled = true;
    const tags = placed.map((t, i) => {
      const prev = this.shown.get(t.id);
      let s;
      if (!prev || Math.abs(t.x - prev.x) > snapPx || Math.abs(t.y - prev.y) > snapPx) {
        s = { x: t.x, y: t.y, tickPx: t.tickPx };
      } else {
        s = {
          x: prev.x + alpha * (t.x - prev.x),
          y: prev.y + alpha * (t.y - prev.y),
          tickPx: prev.tickPx + alpha * (t.tickPx - prev.tickPx),
        };
        if (Math.abs(t.x - s.x) > 0.5 || Math.abs(t.y - s.y) > 0.5 || Math.abs(t.tickPx - s.tickPx) > 0.5) settled = false;
        else s = { x: t.x, y: t.y, tickPx: t.tickPx };
      }
      next.set(t.id, s);
      return {
        id: t.id,
        kind: t.kind,
        building: t.building,
        name: t.name,
        distanceM: t.distanceM,
        distanceText: t.distanceText,
        bearingDeg: t.bearingDeg,
        screenX: s.x,
        screenY: s.y,
        visible: t.visible,
        offscreenSide: t.offscreenSide,
        scale: t.scale,
        opacity: t.opacity,
        occluded: t.occluded,
        priority: i,
        focused: t.id === focusId,
        labelName: t.labelName,
        row: t.row,
        tickPx: s.tickPx,
        camAzDeg: t.camAzDeg,
        camElDeg: t.camElDeg,
      };
    });
    this.shown = next;
    return { tags, settled, pendingMs, focusId, hFovDeg, vFovDeg, ...angles };
  }
}
