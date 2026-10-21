import { describe, it, expect } from 'vitest';
import {
  CAMPUS_BOUNDS, isGrounds, isOnCampus, mergeCampusPlaces, parseAliases, placeMatches, toCampusPlace, validateNewPlace,
} from '../src/utils/campusPlaces.js';
import { getBuildingAsset } from '../src/data/srmBuildingAssets.js';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase.js';

const GOOD = { name: 'Vendhar Square', category: 'LOGISTICS', lat: 12.8238, lng: 80.0456, info: 'Food court', aliases: ['vendhar sq'] };

describe('toCampusPlace', () => {
  it('turns a good document into a place with a string id that can never clash with the database', () => {
    const p = toCampusPlace('abc', GOOD);
    expect(p).toMatchObject({ id: 'cp-abc', name: 'Vendhar Square', category: 'LOGISTICS', lat: 12.8238, lng: 80.0456, aliases: ['vendhar sq'], added: true });
    expect(SRM_MASTER_DATABASE.some((b) => b.id === p.id)).toBe(false);
  });

  it.each([
    ['no name', { ...GOOD, name: '  ' }],
    ['a name that is too long', { ...GOOD, name: 'X'.repeat(61) }],
    ['an unknown category', { ...GOOD, category: 'SPACEPORT' }],
    ['a pin in the wrong country', { ...GOOD, lat: 28.6, lng: 77.2 }],
    ['text coordinates', { ...GOOD, lat: '12.8238' }],
    ['missing coordinates', { name: 'X', category: 'GROUNDS' }],
  ])('skips a hand-edited document with %s', (_what, data) => {
    expect(toCampusPlace('abc', data)).toBeNull();
  });

  it('skips a document with no id', () => {
    expect(toCampusPlace('', GOOD)).toBeNull();
  });
});

describe('validateNewPlace', () => {
  it('uppercases the name like the database and trims the rest', () => {
    const r = validateNewPlace({ ...GOOD, name: '  vendhar   square ', aliases: ' Vendhar Sq ,, vendhar sq ' });
    expect(r).toEqual({ ok: true, fields: { name: 'VENDHAR SQUARE', category: 'LOGISTICS', lat: 12.8238, lng: 80.0456, info: 'Food court', aliases: ['Vendhar Sq'] } });
  });

  it.each([
    ['name', { name: ' ' }],
    ['nameLong', { name: 'X'.repeat(61) }],
    ['category', { category: 'NOPE' }],
    ['offCampus', { lat: 13.5 }],
    ['offCampus', { lng: Number.NaN }],
  ])('rejects with reason %s', (reason, change) => {
    expect(validateNewPlace({ ...GOOD, ...change })).toEqual({ ok: false, reason });
  });

  it('will not reuse a name or short name that already belongs to a place, in any case', () => {
    const existing = [{ name: 'TECH PARK', aliases: ['TP'] }];
    expect(validateNewPlace({ ...GOOD, name: 'tech park' }, existing)).toEqual({ ok: false, reason: 'duplicate' });
    expect(validateNewPlace({ ...GOOD, name: 'tp' }, existing)).toEqual({ ok: false, reason: 'duplicate' });
    expect(validateNewPlace({ ...GOOD, aliases: 'tp' }, existing)).toEqual({ ok: false, reason: 'aliasTaken' });
    expect(validateNewPlace({ ...GOOD, aliases: 'vendhar square' })).toEqual({ ok: false, reason: 'aliasTaken' });
  });

  it('the campus box holds every database building', () => {
    for (const b of SRM_MASTER_DATABASE) expect(isOnCampus(b.lat, b.lng), b.name).toBe(true);
    expect(CAMPUS_BOUNDS.minLat).toBeLessThan(CAMPUS_BOUNDS.maxLat);
  });
});

describe('parseAliases', () => {
  it('splits on commas and newlines, drops blanks and repeats, and caps the count', () => {
    expect(parseAliases('a, b\nc,, A ')).toEqual(['a', 'b', 'c']);
    expect(parseAliases('1,2,3,4,5,6,7,8')).toHaveLength(6);
    expect(parseAliases(null)).toEqual([]);
  });
});

describe('mergeCampusPlaces', () => {
  const base = [{ id: 1, name: 'TECH PARK' }, { id: 2, name: 'JAVA GREEN' }];
  it('puts the added places after the built-in ones, which are never changed', () => {
    const out = mergeCampusPlaces(base, [{ id: 'cp-a', name: 'FABLAB' }]);
    expect(out.map((p) => p.id)).toEqual([1, 2, 'cp-a']);
    expect(out[0]).toBe(base[0]);
  });
  it('drops an added place that reuses a built-in name, and a repeat among the added', () => {
    const out = mergeCampusPlaces(base, [{ id: 'cp-a', name: 'tech park' }, { id: 'cp-b', name: 'FABLAB' }, { id: 'cp-c', name: 'Fablab' }]);
    expect(out.map((p) => p.id)).toEqual([1, 2, 'cp-b']);
  });
});

describe('placeMatches', () => {
  const p = { name: 'VENDHAR SQUARE', aliases: ['Food Court 2'] };
  it('matches the name or any short name, in any case, and everything for an empty search', () => {
    expect(placeMatches(p, 'vendhar')).toBe(true);
    expect(placeMatches(p, 'court 2')).toBe(true);
    expect(placeMatches(p, 'library')).toBe(false);
    expect(placeMatches(p, '  ')).toBe(true);
    expect(placeMatches({ name: 'TECH PARK' }, 'tech')).toBe(true);
  });
});

describe('open ground', () => {
  const ground = { id: 'cp-g', name: 'DENTAL GROUND', category: 'GROUNDS', lat: 12.8255, lng: 80.0485, info: '' };
  it('is told apart from a building', () => {
    expect(isGrounds(ground)).toBe(true);
    expect(isGrounds(SRM_MASTER_DATABASE[0])).toBe(false);
  });
  it('has no floors, lift, facilities or invented closing time on its card', () => {
    const a = getBuildingAsset(ground);
    expect(a.floors).toBeNull();
    expect(a.facilities).toEqual([]);
    expect(a.departments).toEqual([]);
    expect(a.hours).not.toMatch(/\d:\d\d/);
    expect(a.categoryDisplay).toBe('Campus Ground');
  });
  it('leaves every building card as it was', () => {
    const a = getBuildingAsset({ id: 9999, name: 'X', category: 'ACADEMIC' });
    expect(a.floors).toBe(6);
    expect(a.facilities).toContain('Elevator');
  });
});
