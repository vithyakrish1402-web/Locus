import { describe, expect, it } from 'vitest';
import {
  EXACT_TOUR_MAX, TOUR_PLACES, chipFor, doneDoor, endPassage, imHere, plainStatus, progress, readyItems, resultsSummary,
  shortestTour, skipDoor, startPassage, startWalk, tourLength, undo, whyNotReady,
} from '../src/utils/floor7Guided.js';

const permutations = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

describe('the route', () => {
  it('starts at Room 701 and visits every door once', () => {
    const tour = shortestTour('r701', TOUR_PLACES);
    expect(tour[0]).toBe('r701');
    expect([...tour].sort()).toEqual([...TOUR_PLACES].sort());
  });

  it('is the shortest walk: no other order of a small set is shorter (checked against every order)', () => {
    const ids = ['r701', 'r706A', 'r703', 'rW', 'labC', 'r705'];
    const best = shortestTour('r701', ids);
    const all = permutations(ids.slice(1)).map((p) => tourLength(['r701', ...p]));
    expect(tourLength(best)).toBeCloseTo(Math.min(...all), 6);
  });

  it('beats the order of the list, and a fresh walk through 15 doors is solved exactly', () => {
    expect(TOUR_PLACES.length).toBeLessThanOrEqual(EXACT_TOUR_MAX);
    expect(tourLength(shortestTour('r701', TOUR_PLACES))).toBeLessThan(tourLength(TOUR_PLACES));
  });

  it('copes with one door, and falls back to nearest-first past the exact limit', () => {
    expect(shortestTour('r701', ['r701'])).toEqual(['r701']);
    const walk = (a, b) => Math.abs(Number(a) - Number(b));
    const ids = Array.from({ length: EXACT_TOUR_MAX + 3 }, (_, i) => String(i));
    expect(shortestTour('0', ids, walk)).toEqual(ids);
  });
});

describe('where the person is in the walk', () => {
  const doors = ['r701', 'r702', 'r703'];

  it('goes door, countdown, next door, then the passage, then finished', () => {
    let s = startWalk(doors);
    expect([s.phase, progress(s)]).toEqual(['door', { at: 1, of: 3 }]);
    s = imHere(s);
    expect(s.phase).toBe('dwell');
    s = doneDoor(s);
    expect([s.phase, s.index, s.done]).toEqual(['door', 1, ['r701']]);
    s = skipDoor(s);
    expect([s.index, s.skipped]).toEqual([2, ['r702']]);
    s = doneDoor(imHere(s));
    expect(s.phase).toBe('passage');
    s = startPassage(s);
    expect(s.phase).toBe('walking');
    s = endPassage(s);
    expect(s.phase).toBe('finished');
  });

  it('ignores a button that does not belong to the phase', () => {
    const s = startWalk(doors);
    expect(doneDoor(s)).toBe(s);
    expect(startPassage(s)).toBe(s);
    expect(endPassage(s)).toBe(s);
    expect(imHere(imHere(s)).phase).toBe('dwell');
  });

  it('goes straight to the passage when no door is chosen', () => {
    expect(startWalk([]).phase).toBe('passage');
  });

  it('Undo takes back the I\'m here (and says the recorder\'s mark must go), even after Done, and a skip without a mark', () => {
    let s = startWalk(doors);
    s = doneDoor(imHere(s)); // door 1 marked and finished
    let u = undo(s);
    expect(u.removesMark).toBe(true);
    expect([u.state.phase, u.state.index]).toEqual(['door', 0]);
    s = skipDoor(startWalk(doors));
    u = undo(s);
    expect(u.removesMark).toBe(false);
    expect([u.state.phase, u.state.index, u.state.skipped]).toEqual(['door', 0, []]);
    expect(undo(startWalk(doors))).toEqual({ state: startWalk(doors), removesMark: false });
  });
});

describe('the words', () => {
  const at = 1_000_000;
  const step = (over = {}) => ({ at, status: 'tracking', filtered: { x: 0, y: 0 }, uncertaintyM: 4, ...over });

  it('says in one sentence what is happening', () => {
    expect(plainStatus({ last: null, leftScreen: false, now: at })).toBe('Waiting for the first position.');
    expect(plainStatus({ last: step(), leftScreen: false, now: at + 5000 })).toBe('Position shown.');
    expect(plainStatus({ last: step({ status: 'rejected' }), leftScreen: false, now: at })).toMatch(/Ignored one jumpy reading/);
    expect(plainStatus({ last: step({ status: 'reacquiring' }), leftScreen: false, now: at })).toMatch(/found you again/);
    expect(plainStatus({ last: step({ filtered: null, status: 'confirming' }), leftScreen: false, now: at })).toMatch(/second reading that agrees/);
    expect(plainStatus({ last: step(), leftScreen: false, now: at + 120_000 })).toMatch(/No new reading for 120 s/);
    expect(plainStatus({ last: step(), leftScreen: true, now: at })).toMatch(/left the screen, so readings may be slower/);
  });

  it('turns a result into a chip: green to 5 m, amber to 10 m, red beyond, grey for none', () => {
    const chip = (walkM) => chipFor({ shown: true, walkM }).tone;
    expect([chip(0), chip(5), chip(5.01), chip(10), chip(10.01)]).toEqual(['good', 'good', 'fair', 'fair', 'far']);
    expect(chipFor({ shown: false })).toEqual({ tone: 'none', label: 'No position' });
  });

  it('summarises: typical error, doors within 5 m, the worst, and the doors with nothing', () => {
    const row = (place, walkM, shown = true) => ({ place, walkM, shown });
    const rows = [row('Room 701', 2), row('Room 702', 4), row('New ladies restroom (\'W\')', 21), row('Room 703', 0, false)];
    expect(resultsSummary(rows)).toBe('Typical error 4.0 m. 2 of 4 doors within 5 m. Worst: New ladies restroom, 21 m. 1 door showed no position.');
    expect(resultsSummary([])).toMatch(/nothing to score/);
    expect(resultsSummary([row('A', 0, false)])).toBe('None of the 1 doors showed a position.');
  });
});

describe('the ready check', () => {
  const now = 1_000_000;
  const ok = { outcome: 'estimate', at: now };
  const shown = [{ at: now - 10_000, filtered: { x: 0, y: 0 } }];
  const check = (over = {}) => readyItems({ inGroup: true, cycle: ok, trail: shown, now, waitingSince: now - 42_000, ...over });
  const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

  it('ticks everything when all is well, and has no reason to wait', () => {
    expect(check().every((i) => i.ok)).toBe(true);
    expect(whyNotReady(check())).toBe('');
  });

  it('is not ready outside a group, and says so', () => {
    const items = check({ inGroup: false });
    expect(byId(items).group).toMatchObject({ ok: false });
    expect(byId(items).group.fix).toMatch(/Create a group, or join one/);
    expect(whyNotReady(items)).toBe('Still needed before Start: in a group, Location on, Wi-Fi permission, Wi-Fi on, first position.');
  });

  it('reads Location, permission and Wi-Fi from the scan error, one at a time, with a fix for each', () => {
    const bad = (error) => byId(check({ cycle: { outcome: 'scan-error', error } }));
    expect(bad('LOCATION_OFF').location.ok).toBe(false);
    expect(bad('LOCATION_OFF').wifi.ok).toBe(true);
    expect(bad('PERMISSION_DENIED').permission.ok).toBe(false);
    expect(bad('WIFI_OFF').wifi.ok).toBe(false);
    for (const k of ['location', 'permission', 'wifi']) expect(bad('LOCATION_OFF')[k].fix.length).toBeGreaterThan(10);
  });

  it('cannot tell yet before the first scan cycle, so it does not tick them', () => {
    const items = byId(check({ cycle: null }));
    expect([items.location.ok, items.permission.ok, items.wifi.ok]).toEqual([false, false, false]);
  });

  it('waits for the first position and counts the seconds; an old position does not count', () => {
    const waiting = byId(check({ trail: [] })).position;
    expect(waiting).toMatchObject({ ok: false, waitingS: 42 });
    expect(byId(check({ trail: [{ at: now - 300_000, filtered: { x: 0, y: 0 } }] })).position.ok).toBe(false);
    expect(byId(check({ trail: [{ at: now - 10_000, filtered: null }] })).position.ok).toBe(false);
  });
});
