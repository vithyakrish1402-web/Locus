import { describe, it, expect } from 'vitest';
import { rallyAction, rallyIsAt } from '../src/utils/rallyAction';

describe('the place card Rally button', () => {
  it('says to join a group first when you are in none, whatever else is true', () => {
    expect(rallyAction({ inGroup: false, isHere: false, canClear: false })).toBe('join-first');
    expect(rallyAction({ inGroup: false, isHere: true, canClear: true })).toBe('join-first');
  });

  it('offers to set it when it is not on this place', () => {
    expect(rallyAction({ inGroup: true, isHere: false, canClear: false })).toBe('set');
    expect(rallyAction({ inGroup: true, isHere: false, canClear: true })).toBe('set');
  });

  it('offers to clear it when it is here and yours to clear', () => {
    expect(rallyAction({ inGroup: true, isHere: true, canClear: true })).toBe('clear');
  });

  it('says it is not yours to clear when it is here and you cannot', () => {
    expect(rallyAction({ inGroup: true, isHere: true, canClear: false })).toBe('cannot-clear');
  });

  it('knows a rally point is at a place by its coordinates, and handles none', () => {
    const place = { lat: 12.82, lng: 80.04 };
    expect(rallyIsAt({ lat: 12.82, lng: 80.04, name: 'X' }, place)).toBe(true);
    expect(rallyIsAt({ lat: 12.82, lng: 80.05 }, place)).toBe(false);
    expect(rallyIsAt(null, place)).toBe(false);
    expect(rallyIsAt({ lat: 1, lng: 2 }, null)).toBe(false);
  });
});
