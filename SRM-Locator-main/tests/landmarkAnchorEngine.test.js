import { describe, it, expect } from 'vitest';
import {
  LandmarkAnchorEngine,
  orientationFromAngles,
  anglesFromOrientation,
  applyAlignment,
  computeAlignment,
  clampAlignment,
  loadAlignment,
  saveAlignment,
  ALIGNMENT_STORAGE_KEY,
  NO_ALIGNMENT,
  effectiveHorizontalFov,
  findOccluded,
  layoutTags,
  shortenName,
  createFocusTracker,
  CAMERA_LONG_SIDE_FOV_DEG,
  DEFAULT_BUILDING_HEIGHT_M,
  HEIGHT_ANCHOR_RATIO,
  PHONE_HEIGHT_M,
  PERSON_HEIGHT_M,
  MAX_RANGE_M,
  MIN_OPACITY,
  OCCLUDED_OPACITY,
  SMOOTHING,
  LOCK_HOLD_MS,
  MAX_ALIGN_OFFSET_DEG,
  GPS_MIN_ACCURACY_M,
  TAG_SCREEN_MARGIN_PX,
  TAG_LABEL_HEIGHT_PX,
  TAG_TICK_PX,
  TAG_ROW_GAP_PX,
  TAG_SHORT_NAME_CHARS,
  TAG_CHAR_PX,
  TAG_CHROME_PX,
  TAG_EDGE_ARROW_PX,
} from '../src/utils/landmarkAnchorEngine.js';
import { calculateBearing } from '../src/utils/geoMath.js';

// --- Fake world: a phone at HERE, a tall phone screen, landmarks placed by bearing.
const HERE = { lat: 12.8230, lng: 80.0440 };
const W = 412;
const H = 891;
const FOV = 40;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const tanH = Math.tan(rad(FOV / 2));
const tanV = (tanH * H) / W;
const at = (bearing, meters, from = HERE) => {
  const r = rad(bearing);
  return {
    lat: from.lat + (meters * Math.cos(r)) / 111320,
    lng: from.lng + (meters * Math.sin(r)) / (111320 * Math.cos(rad(from.lat))),
  };
};
const building = (id, bearing, meters, extra = {}) => ({ id, kind: 'building', name: id, heightM: null, ...at(bearing, meters), ...extra });

const engineWith = (landmarks, position = HERE) => {
  const e = new LandmarkAnchorEngine();
  e.setPosition(position);
  e.setLandmarks(landmarks);
  return e;
};
// One frame; `angles` as orientationFromAngles takes them.
const frame = (e, angles = {}, extra = {}) =>
  e.frame({ ...angles, hFovDeg: FOV, width: W, height: H, nowMs: 0, ...extra });
const tagOf = (f, id) => f.tags.find((t) => t.id === id);
// Where a pinhole camera facing level puts a point `elDeg` above the horizon.
const yForElevation = (elDeg, pitchDeg = 0) => (H / 2) * (1 - Math.tan(rad(elDeg - pitchDeg)) / tanV);
const anchorElevation = (heightM, distance) => deg(Math.atan((heightM * HEIGHT_ANCHOR_RATIO - PHONE_HEIGHT_M) / distance));

describe('[acceptance] facing a building centres its tag horizontally on it', () => {
  it('puts the tag at the screen’s centre column for the exact bearing, from any direction', () => {
    for (const bearing of [0, 37, 181, 359]) {
      const b = building('B', bearing, 150);
      const e = engineWith([b]);
      const heading = calculateBearing(HERE.lat, HERE.lng, b.lat, b.lng);
      const t = tagOf(frame(e, { headingDeg: heading }), 'B');
      expect(t.visible).toBe(true);
      expect(t.screenX).toBeCloseTo(W / 2, 2); // within 0.005 px (local metres vs great circle)
    }
  });

  it('places off-centre landmarks by the pinhole lens: tan(angle) across the view', () => {
    const e = engineWith([building('B', 10, 200)]);
    const t = tagOf(frame(e, { headingDeg: 0 }), 'B');
    const diff = calculateBearing(HERE.lat, HERE.lng, at(10, 200).lat, at(10, 200).lng);
    expect(t.screenX).toBeCloseTo((W / 2) * (1 + Math.tan(rad(diff)) / tanH), 0);
    expect(t.bearingDeg).toBeCloseTo(diff, 9);
  });
});

describe('[acceptance] tilting up and down moves the tag with the building', () => {
  it('puts the tag HEIGHT_ANCHOR_RATIO up the building, through the camera’s pitch', () => {
    const b = building('B', 0, 120);
    for (const pitch of [-20, 0, 10]) {
      const e = engineWith([b]);
      const t = tagOf(frame(e, { headingDeg: 0, pitchDeg: pitch }), 'B');
      expect(t.screenY).toBeCloseTo(yForElevation(anchorElevation(DEFAULT_BUILDING_HEIGHT_M, t.distanceM), pitch), 0);
    }
  });

  it('moves the tag down the screen as the phone tilts up, as the building does', () => {
    const b = building('B', 0, 120);
    const ys = [-15, -5, 5, 15].map((pitch) => tagOf(frame(engineWith([b]), { headingDeg: 0, pitchDeg: pitch }), 'B').screenY);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });

  it('turns the tag round the screen’s centre as the phone rolls, so it stays on the building', () => {
    const b = building('B', 8, 100, { heightM: 40 });
    const level = tagOf(frame(engineWith([b]), { headingDeg: 0 }), 'B');
    const rolled = tagOf(frame(engineWith([b]), { headingDeg: 0, rollDeg: 12 }), 'B');
    const off = (t) => [t.screenX - W / 2, t.screenY - H / 2];
    const [x0, y0] = off(level);
    const [x1, y1] = off(rolled);
    expect(Math.hypot(x1, y1)).toBeCloseTo(Math.hypot(x0, y0), 6); // same distance from the centre
    // Rolling the phone clockwise turns the world, and so the tag, anticlockwise on screen.
    expect(deg(Math.atan2(y0, x0) - Math.atan2(y1, x1))).toBeCloseTo(12, 6);
  });

  it('round-trips heading, pitch and roll through the orientation', () => {
    const angles = { headingDeg: 123, pitchDeg: -17, rollDeg: 9 };
    const back = anglesFromOrientation(orientationFromAngles(angles));
    expect(back.headingDeg).toBeCloseTo(123, 9);
    expect(back.pitchDeg).toBeCloseTo(-17, 9);
    expect(back.rollDeg).toBeCloseTo(9, 9);
  });

  it('reports the FOV and the camera’s angles with each frame', () => {
    const f = frame(engineWith([building('B', 0, 100)]), { headingDeg: 10, pitchDeg: 5, rollDeg: -3 });
    expect(f.hFovDeg).toBe(FOV);
    expect(Math.tan(rad(f.vFovDeg / 2))).toBeCloseTo(tanV, 9);
    expect(f.pitchDeg).toBeCloseTo(5, 6);
    expect(f.rollDeg).toBeCloseTo(-3, 6);
  });
});

describe('heights and anchors', () => {
  const heightAt = (landmark) => {
    const t = tagOf(frame(engineWith([landmark]), { headingDeg: 0 }), landmark.id);
    // Back out the anchor's height above the ground from the tag's screen position.
    const el = deg(Math.atan(((H / 2 - t.screenY) / (H / 2)) * tanV));
    return Math.tan(rad(el)) * t.distanceM + PHONE_HEIGHT_M;
  };

  it('anchors HEIGHT_ANCHOR_RATIO up: the default height, a measured one, a person, the ground', () => {
    expect(heightAt(building('B', 0, 150))).toBeCloseTo(DEFAULT_BUILDING_HEIGHT_M * HEIGHT_ANCHOR_RATIO, 0);
    expect(heightAt(building('B', 0, 150, { heightM: 50 }))).toBeCloseTo(50 * HEIGHT_ANCHOR_RATIO, 0);
    expect(heightAt({ id: 'M', kind: 'member', name: 'M', heightM: null, ...at(0, 60) })).toBeCloseTo(PERSON_HEIGHT_M * HEIGHT_ANCHOR_RATIO, 1);
    expect(heightAt({ id: 'T', kind: 'target', name: 'T', heightM: 0, ...at(0, 60) })).toBeCloseTo(0, 1);
  });

  it('nudges an anchor by its anchorOffsetM', () => {
    const plain = tagOf(frame(engineWith([building('B', 0, 100)]), { headingDeg: 0 }), 'B');
    const nudged = tagOf(frame(engineWith([building('B', 0, 100, { anchorOffsetM: { east: 5, north: 0 } })]), { headingDeg: 0 }), 'B');
    expect(nudged.screenX - plain.screenX).toBeCloseTo((W / 2) * (5 / 100 / tanH), 0);
  });
});

describe('[acceptance] one-tap align fixes a consistent sideways error', () => {
  // The compass reads 7 deg clockwise of the truth and the camera is tipped 3 deg further
  // down than the sensor says. The user points straight at B and taps ALIGN.
  it('measures the error from the centred landmark and puts the tags back on the buildings', () => {
    const b = building('B', 30, 200);
    const a = building('A', 50, 250);
    const trueHeading = calculateBearing(HERE.lat, HERE.lng, b.lat, b.lng);
    const trueEl = anchorElevation(DEFAULT_BUILDING_HEIGHT_M, 200);
    const seen = { headingDeg: trueHeading + 7, pitchDeg: trueEl + 3 }; // what the sensors claim
    const before = frame(engineWith([b, a]), seen);
    expect(Math.abs(tagOf(before, 'B').screenX - W / 2)).toBeGreaterThan(30); // visibly off

    const result = computeAlignment({ tag: tagOf(before, 'B'), accuracyM: 5 });
    expect(result.ok).toBe(true);
    expect(result.alignment.headingOffsetDeg).toBeCloseTo(-7, 1);
    expect(result.alignment.pitchOffsetDeg).toBeCloseTo(-3, 1);

    const q = applyAlignment(orientationFromAngles(seen), result.alignment);
    const after = frame(engineWith([b, a]), {}, { q });
    expect(tagOf(after, 'B').screenX).toBeCloseTo(W / 2, 0);
    expect(tagOf(after, 'B').screenY).toBeCloseTo(H / 2, 0);
    // And every other tag moves by the same correction: A lands where the truth puts it.
    const truth = frame(engineWith([b, a]), { headingDeg: trueHeading, pitchDeg: trueEl });
    expect(tagOf(after, 'A').screenX).toBeCloseTo(tagOf(truth, 'A').screenX, 0);
    expect(tagOf(after, 'A').screenY).toBeCloseTo(tagOf(truth, 'A').screenY, 0);
  });

  it('adds to the correction already in place, never beyond +-MAX_ALIGN_OFFSET_DEG', () => {
    const tag = { building: true, visible: true, distanceM: 300, camAzDeg: 8, camElDeg: -2 };
    const r = computeAlignment({ tag, accuracyM: 4, current: { headingOffsetDeg: 15, pitchOffsetDeg: 1 } });
    expect(r.alignment).toEqual({ headingOffsetDeg: MAX_ALIGN_OFFSET_DEG, pitchOffsetDeg: -1 });
  });

  it('refuses without a building in view, with a poor fix, too close, or far off centre', () => {
    const tag = { building: true, visible: true, distanceM: 300, camAzDeg: 2, camElDeg: 1 };
    expect(computeAlignment({ tag: null, accuracyM: 4 })).toEqual({ ok: false, reason: 'no-landmark' });
    expect(computeAlignment({ tag: { ...tag, building: false }, accuracyM: 4 }).reason).toBe('no-landmark');
    expect(computeAlignment({ tag: { ...tag, visible: false }, accuracyM: 4 }).reason).toBe('no-landmark');
    expect(computeAlignment({ tag, accuracyM: GPS_MIN_ACCURACY_M + 1 }).reason).toBe('gps');
    expect(computeAlignment({ tag, accuracyM: null }).reason).toBe('gps');
    expect(computeAlignment({ tag: { ...tag, distanceM: 60 }, accuracyM: 12 }).reason).toBe('too-close');
    expect(computeAlignment({ tag: { ...tag, camAzDeg: MAX_ALIGN_OFFSET_DEG + 1 }, accuracyM: 4 }).reason).toBe('not-centred');
    expect(computeAlignment({ tag: { ...tag, camElDeg: -MAX_ALIGN_OFFSET_DEG - 1 }, accuracyM: 4 }).reason).toBe('not-centred');
  });

  it('keeps the correction for the session in storage, and forgets it on reset', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    expect(loadAlignment(storage)).toEqual(NO_ALIGNMENT);
    saveAlignment(storage, { headingOffsetDeg: -6.5, pitchOffsetDeg: 2 });
    expect(loadAlignment(storage)).toEqual({ headingOffsetDeg: -6.5, pitchOffsetDeg: 2 });
    saveAlignment(storage, NO_ALIGNMENT);
    expect(store.has(ALIGNMENT_STORAGE_KEY)).toBe(false);
    store.set(ALIGNMENT_STORAGE_KEY, '{not json');
    expect(loadAlignment(storage)).toEqual(NO_ALIGNMENT);
    store.set(ALIGNMENT_STORAGE_KEY, JSON.stringify({ headingOffsetDeg: 90, pitchOffsetDeg: 'x' }));
    expect(loadAlignment(storage)).toEqual({ headingOffsetDeg: MAX_ALIGN_OFFSET_DEG, pitchOffsetDeg: 0 });
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadAlignment(broken)).toEqual(NO_ALIGNMENT);
    expect(() => saveAlignment(broken, { headingOffsetDeg: 1, pitchOffsetDeg: 0 })).not.toThrow();
    expect(clampAlignment({ headingOffsetDeg: -50 }).headingOffsetDeg).toBe(-MAX_ALIGN_OFFSET_DEG);
  });
});

// Estimated label box, as the layout sizes it, from a frame tag.
const boxOf = (t) => {
  const s = t.scale ?? 1;
  const w = (TAG_CHROME_PX + t.labelName.length * TAG_CHAR_PX + t.distanceText.length * TAG_CHAR_PX + (t.offscreenSide ? TAG_EDGE_ARROW_PX : 0)) * s;
  const bottom = t.screenY - t.tickPx;
  return { left: t.screenX - w / 2, right: t.screenX + w / 2, top: bottom - TAG_LABEL_HEIGHT_PX * s, bottom };
};
const overlaps = (a, b) => !(a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top);

describe('[acceptance] no tag is cut off at the screen edge', () => {
  it('clamps landmarks just outside the view to the nearer edge, with an arrow side', () => {
    const e = engineWith([building('LEFT', -40, 150), building('RIGHT', 35, 150), building('BEHIND', 180, 150)]);
    const f = frame(e, { headingDeg: 0 });
    expect(tagOf(f, 'LEFT').offscreenSide).toBe('left');
    expect(tagOf(f, 'RIGHT').offscreenSide).toBe('right');
    expect(tagOf(f, 'LEFT').visible).toBe(false);
    expect(tagOf(f, 'BEHIND')).toBeUndefined(); // far past the edge: no tag
  });

  it('always shows the destination, on the edge when it is behind', () => {
    const e = engineWith([{ id: 'target', kind: 'target', name: 'RALLY', heightM: 0, ...at(170, 300) }]);
    const t = tagOf(frame(e, { headingDeg: 0 }, { targetId: 'target' }), 'target');
    expect(t.offscreenSide).toBe('right');
  });

  it('keeps every label whole inside the screen, edge tags and long names included', () => {
    const e = engineWith([
      building('A_VERY_LONG_BUILDING_NAME_ON_THE_LEFT', -38, 120),
      building('ANOTHER_EXTREMELY_LONG_NAME_RIGHT', 30, 140),
      building('UP_HIGH', 0, 40, { heightM: 120 }),
      building('MID', 5, 200),
    ]);
    const f = frame(e, { headingDeg: 0, pitchDeg: -10 });
    expect(f.tags.length).toBeGreaterThanOrEqual(3);
    for (const t of f.tags) {
      const b = boxOf(t);
      const cap = 0.4 * W; // ARTag's max-w-[40vw] truncates a long name on screen
      const w = Math.min(b.right - b.left, cap);
      expect(t.screenX - w / 2).toBeGreaterThanOrEqual(TAG_SCREEN_MARGIN_PX - 1e-6);
      expect(t.screenX + w / 2).toBeLessThanOrEqual(W - TAG_SCREEN_MARGIN_PX + 1e-6);
      expect(b.top).toBeGreaterThanOrEqual(TAG_SCREEN_MARGIN_PX - 1e-6);
      expect(t.screenY).toBeLessThanOrEqual(H - TAG_SCREEN_MARGIN_PX + 1e-6);
    }
  });
});

describe('[acceptance] overlapping tags separate cleanly; the destination stays on top', () => {
  it('keeps the nearer of two overlapping tags in place and lifts the farther a row', () => {
    const e = engineWith([building('FAR', 1, 240), building('NEAR', 0, 200)]);
    const f = frame(e, { headingDeg: 0 });
    expect(tagOf(f, 'NEAR').row).toBe(0);
    expect(tagOf(f, 'FAR').row).toBe(1);
    // Lifted just clear of NEAR's label: its tick reaches from its point to TAG_ROW_GAP_PX
    // above that label.
    const nearTop = boxOf(tagOf(f, 'NEAR')).top;
    expect(tagOf(f, 'FAR').screenY - tagOf(f, 'FAR').tickPx).toBeCloseTo(nearTop - TAG_ROW_GAP_PX, 6);
    expect(overlaps(boxOf(tagOf(f, 'NEAR')), boxOf(tagOf(f, 'FAR')))).toBe(false);
    // Drawn nearer last, so it is on top.
    expect(tagOf(f, 'NEAR').priority).toBeGreaterThan(tagOf(f, 'FAR').priority);
  });

  it('puts the destination first in the layout and last in the drawing, whatever is nearer', () => {
    const e = engineWith([building('NEAR', 0, 80), { id: 'target', kind: 'target', name: 'RALLY', heightM: 15, ...at(0.5, 220) }]);
    const f = frame(e, { headingDeg: 0 }, { targetId: 'target' });
    expect(tagOf(f, 'target').row).toBe(0);
    expect(f.tags.at(-1).id).toBe('target');
  });

  it('never overlaps two labels in a crowd', () => {
    const crowd = Array.from({ length: 8 }, (_, i) => building(`B${i}`, -12 + i * 3, 150 + i * 20));
    const f = frame(engineWith(crowd), { headingDeg: 0 });
    const boxes = f.tags.map(boxOf);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
  });
});

describe('layoutTags', () => {
  const t = (id, x, y, d, extra = {}) => ({ id, isTarget: false, name: `BLDG_${id}`, distanceM: d, distanceText: `${d} M`, offscreenSide: null, x, y, scale: 1, ...extra });

  it('gives the destination the first row even when a nearer tag sits on the same spot', () => {
    const out = layoutTags([t('near', 200, 400, 50), t('target', 200, 400, 300, { isTarget: true })], { width: W, height: H });
    expect(out.find((p) => p.id === 'target').row).toBe(0);
    expect(out.find((p) => p.id === 'near').row).toBe(1);
  });

  it('cuts a crowded name short before giving up on it, and drops it with no room at all', () => {
    const wide = (id, d) => t(id, 142, 360, d, { name: 'WWWWWWWWWWWWWWW' });
    const out = layoutTags([wide('a', 100), wide('b', 110), wide('c', 120), t('d', 309, 360, 130, { name: 'LONGER_NAME_THAN_FITS' })], { width: W, height: H });
    const d = out.find((p) => p.id === 'd');
    expect(d.labelName).toBe(shortenName('LONGER_NAME_THAN_FITS'));
    expect(d.labelName).toHaveLength(TAG_SHORT_NAME_CHARS + 1);
    const packed = layoutTags(Array.from({ length: 6 }, (_, i) => wide(String(i), 100 + i)), { width: W, height: H });
    expect(packed.length).toBeLessThan(6);
  });

  it('shortenName cuts a long name and leaves a short one', () => {
    expect(shortenName('TECH PARK BLOCK', 4)).toBe('TECH…');
    expect(shortenName('UB', 4)).toBe('UB');
  });
});

describe('visibility, fading and occlusion', () => {
  it('fills the tag cap with what is in view before any edge tag, however near', () => {
    const nearOff = building('NEAR_OFF', 30, 40); // just off the right edge, nearest of all
    const inView = Array.from({ length: 6 }, (_, i) => building(`V${i}`, -15 + i * 6, 200 + i * 40));
    const f = frame(engineWith([nearOff, ...inView]), { headingDeg: 0 });
    expect(tagOf(f, 'NEAR_OFF')).toBeUndefined();
    const fewer = frame(engineWith([nearOff, ...inView.slice(0, 2)]), { headingDeg: 0 });
    expect(tagOf(fewer, 'NEAR_OFF').offscreenSide).toBe('right');
  });

  it(`shows nothing beyond MAX_RANGE_M (${MAX_RANGE_M} m) but the destination`, () => {
    const e = engineWith([building('FAR', 0, MAX_RANGE_M + 50), { id: 'target', kind: 'target', name: 'T', heightM: 0, ...at(2, 2000) }]);
    const f = frame(e, { headingDeg: 0 }, { targetId: 'target' });
    expect(tagOf(f, 'FAR')).toBeUndefined();
    expect(tagOf(f, 'target')).toBeTruthy();
  });

  it('fades and shrinks tags with distance', () => {
    const alone = (id, d) => tagOf(frame(engineWith([building(id, 0, d)]), { headingDeg: 0 }), id);
    const [n, m, fa] = [alone('N', 50), alone('M', 300), alone('F', 490)];
    expect(n.opacity).toBe(1);
    expect(m.opacity).toBeLessThan(1);
    expect(fa.opacity).toBeLessThan(m.opacity);
    expect(fa.opacity).toBeGreaterThanOrEqual(MIN_OPACITY);
    expect(n.scale).toBe(1);
    expect(fa.scale).toBeLessThan(m.scale);
  });

  it('dims a landmark hidden behind a much nearer, taller one, instead of removing it', () => {
    const near = building('NEAR', 0, 80, { heightM: 40 });
    const far = building('FAR', 1, 400);
    const f = frame(engineWith([near, far]), { headingDeg: 0 });
    expect(tagOf(f, 'FAR').occluded).toBe(true);
    expect(tagOf(f, 'FAR').opacity).toBeCloseTo(OCCLUDED_OPACITY * (1 - (1 - MIN_OPACITY) * ((400 - 250) / 250)), 6);
    expect(tagOf(f, 'NEAR').occluded).toBe(false);
  });

  it('leaves it clear when the nearer one is short, off to the side, or not much nearer', () => {
    const items = (over) => [
      { id: 'near', distanceM: 80, bearingDeg: 0, halfWidthDeg: 10, topElDeg: 20, anchorElDeg: 10, ...over },
      { id: 'far', distanceM: 400, bearingDeg: 1, halfWidthDeg: 2, topElDeg: 3, anchorElDeg: 1 },
    ];
    expect(findOccluded(items({}))).toEqual(new Set(['far']));
    expect(findOccluded(items({ topElDeg: 0.5 }))).toEqual(new Set());
    expect(findOccluded(items({ bearingDeg: 30 }))).toEqual(new Set());
    expect(findOccluded(items({ distanceM: 300 }))).toEqual(new Set());
  });

  it('never dims the destination', () => {
    const near = building('NEAR', 0, 80, { heightM: 40 });
    const target = { id: 'target', kind: 'target', name: 'T', heightM: 15, ...at(1, 400) };
    const t = tagOf(frame(engineWith([near, target]), { headingDeg: 0 }, { targetId: 'target' }), 'target');
    expect(t.occluded).toBe(true);
    expect(t.opacity).toBeGreaterThan(MIN_OPACITY - 1e-9);
  });

  it('uses a footprint’s real width for what it covers', () => {
    const wide = building('WIDE', 0, 80, { heightM: 40, footprint: [[...Object.values(at(-30, 80))], [...Object.values(at(30, 80))], [...Object.values(at(0, 100))]] });
    const far = building('FAR', 20, 400);
    expect(tagOf(frame(engineWith([wide, far]), { headingDeg: 0 }), 'FAR').occluded).toBe(true);
    const narrow = building('NARROW', 0, 80, { heightM: 40 });
    expect(tagOf(frame(engineWith([narrow, far]), { headingDeg: 0 }), 'FAR').occluded).toBe(false);
  });
});

describe('[acceptance] tags stay steady while walking', () => {
  it('ignores position wobble under 2 m, and moves once the phone really has', () => {
    const e = engineWith([building('B', 10, 150)]);
    const first = tagOf(frame(e, { headingDeg: 0 }), 'B');
    e.setPosition(at(90, 1.5)); // GPS wobble
    const wobble = tagOf(frame(e, { headingDeg: 0 }, { nowMs: 16 }), 'B');
    expect(wobble.screenX).toBe(first.screenX);
    expect(wobble.distanceM).toBe(first.distanceM);
    e.setPosition(at(90, 12)); // walked
    const moved = frame(e, { headingDeg: 0 }, { nowMs: 1016 });
    expect(tagOf(moved, 'B').bearingDeg).not.toBe(first.bearingDeg);
  });

  it('glides a small change by elapsed time, the same at any frame rate', () => {
    const run = (stepMs) => {
      const e = engineWith([building('B', 0, 200)]);
      frame(e, { headingDeg: 0 }, { nowMs: 0 });
      let t;
      for (let now = stepMs; now <= 120; now += stepMs) t = tagOf(frame(e, { headingDeg: 2 }, { nowMs: now }), 'B');
      return t.screenX;
    };
    const target = tagOf(frame(engineWith([building('B', 0, 200)]), { headingDeg: 2 }), 'B').screenX;
    const start = W / 2;
    const at60 = run(1000 / 60 * 1.0);
    expect(at60).not.toBeCloseTo(target, 0); // still gliding after 120 ms
    expect(Math.abs(at60 - start)).toBeGreaterThan(Math.abs(target - start) * 0.5); // most of the way
    expect(run(10)).toBeCloseTo(run(40), 0);
    // And the glide's own constant: one SMOOTHING time constant covers ~63%.
    const e = engineWith([building('B', 0, 200)]);
    frame(e, { headingDeg: 0 }, { nowMs: 0 });
    const one = tagOf(frame(e, { headingDeg: 2 }, { nowMs: SMOOTHING }), 'B').screenX;
    expect((one - start) / (target - start)).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it('snaps straight to a big change (a fast turn) instead of gliding', () => {
    const e = engineWith([building('B', 0, 200)]);
    frame(e, { headingDeg: 0 }, { nowMs: 0 });
    const t = tagOf(frame(e, { headingDeg: 12 }, { nowMs: 16 }), 'B');
    const target = tagOf(frame(engineWith([building('B', 0, 200)]), { headingDeg: 12 }), 'B');
    expect(t.screenX).toBeCloseTo(target.screenX, 6);
  });

  it('says when it has settled, so the caller can stop drawing frames', () => {
    const e = engineWith([building('B', 0, 200)]);
    expect(frame(e, { headingDeg: 0 }, { nowMs: 0 }).settled).toBe(true);
    expect(frame(e, { headingDeg: 2 }, { nowMs: 16 }).settled).toBe(false);
    let f;
    for (let now = 32; now < 2000; now += 16) f = frame(e, { headingDeg: 2 }, { nowMs: now });
    expect(f.settled).toBe(true);
  });
});

describe('the focused tag', () => {
  it(`focuses the one nearest the centre, switching only after ${LOCK_HOLD_MS} ms`, () => {
    const f = createFocusTracker();
    expect(f.update([{ id: 'a', offset: 2 }, { id: 'b', offset: 10 }], 0)).toEqual({ id: 'a', pendingMs: null });
    expect(f.update([{ id: 'a', offset: 6 }, { id: 'b', offset: 4 }], 100)).toEqual({ id: 'a', pendingMs: LOCK_HOLD_MS });
    expect(f.update([{ id: 'a', offset: 3 }, { id: 'b', offset: 4 }], 300).id).toBe('a'); // dropped back: wait restarts
    expect(f.update([{ id: 'a', offset: 6 }, { id: 'b', offset: 4 }], 450).id).toBe('a');
    expect(f.update([{ id: 'a', offset: 6 }, { id: 'b', offset: 4 }], 450 + LOCK_HOLD_MS - 1).id).toBe('a');
    expect(f.update([{ id: 'a', offset: 6 }, { id: 'b', offset: 4 }], 450 + LOCK_HOLD_MS).id).toBe('b');
    expect(f.update([{ id: 'c', offset: 9 }], 1000).id).toBe('c'); // left the view: at once
    expect(f.update([], 1001)).toEqual({ id: null, pendingMs: null });
  });

  it('marks it in the frame, and reports a pending switch', () => {
    const e = engineWith([building('A', 1, 150), building('B', -9, 160)]);
    expect(frame(e, { headingDeg: 0 }, { nowMs: 0 }).focusId).toBe('A');
    const f = frame(e, { headingDeg: -8 }, { nowMs: 16 });
    expect(f.focusId).toBe('A');
    expect(f.pendingMs).toBe(LOCK_HOLD_MS);
    expect(frame(e, { headingDeg: -8 }, { nowMs: 16 + LOCK_HOLD_MS }).focusId).toBe('B');
    expect(tagOf(frame(e, { headingDeg: -8 }, { nowMs: 1000 }), 'B').focused).toBe(true);
  });
});

describe('effectiveHorizontalFov', () => {
  it('is the lens across the stream’s short side, narrowed by the crop to fill the screen', () => {
    const stream = deg(2 * Math.atan(Math.tan(rad(CAMERA_LONG_SIDE_FOV_DEG) / 2) * 0.75));
    expect(effectiveHorizontalFov({ videoWidth: 480, videoHeight: 640, screenWidth: 480, screenHeight: 640 })).toBeCloseTo(stream, 6);
    const tall = effectiveHorizontalFov({ videoWidth: 480, videoHeight: 640, screenWidth: W, screenHeight: H });
    expect(tall).toBeLessThan(stream - 10);
    expect(tall).toBeGreaterThan(25);
  });

  it('keeps the long side’s field for a 16:9 stream, and assumes 4:3 before the video plays', () => {
    expect(effectiveHorizontalFov({ videoWidth: 1280, videoHeight: 720, screenWidth: 1280, screenHeight: 720 })).toBeCloseTo(CAMERA_LONG_SIDE_FOV_DEG, 6);
    expect(effectiveHorizontalFov({ screenWidth: W, screenHeight: H }))
      .toBeCloseTo(effectiveHorizontalFov({ videoWidth: 3, videoHeight: 4, screenWidth: W, screenHeight: H }), 9);
  });
});

describe('engine edge cases', () => {
  it('returns no tags before a position, or with no viewport', () => {
    const e = new LandmarkAnchorEngine();
    e.setLandmarks([building('B', 0, 100)]);
    expect(frame(e, { headingDeg: 0 }).tags).toEqual([]);
    e.setPosition(HERE);
    expect(frame(e, { headingDeg: 0 }, { width: 0 }).tags).toEqual([]);
    e.setPosition({ lat: null, lng: 5 }); // ignored
    expect(frame(e, { headingDeg: 0 }).tags).toHaveLength(1);
  });

  it('skips landmarks without a position, and the one you are standing on', () => {
    const e = engineWith([{ id: 'X', kind: 'building', name: 'X', lat: null, lng: 1 }, { id: 'HERE', kind: 'building', name: 'HERE', ...HERE }]);
    expect(frame(e, { headingDeg: 0 }).tags).toEqual([]);
  });

  it('follows a landmark that moves (a squad member) without waiting for the phone to', () => {
    const e = engineWith([{ id: 'M', kind: 'member', name: 'M', heightM: null, ...at(0, 50) }]);
    const a = tagOf(frame(e, { headingDeg: 0 }), 'M');
    e.setLandmarks([{ id: 'M', kind: 'member', name: 'M', heightM: null, ...at(5, 50) }]);
    const b = tagOf(frame(e, { headingDeg: 0 }, { nowMs: 2000 }), 'M');
    expect(b.screenX).toBeGreaterThan(a.screenX);
  });
});
