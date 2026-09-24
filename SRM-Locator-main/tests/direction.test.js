import { describe, it, expect } from 'vitest';
import { compassPoint, relativeClock, continuousAngle, freshness, formatMetres, sortByDistance } from '../src/utils/direction.js';

describe('compassPoint', () => {
  it('names the nearest of eight points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(44)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(200)).toBe('S');
    expect(compassPoint(337.6)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
    expect(compassPoint(NaN)).toBeNull();
  });
});

describe('relativeClock', () => {
  it('reads like a clock face from where the phone points', () => {
    expect(relativeClock(90, 90).label).toBe('AHEAD');
    expect(relativeClock(180, 90).label).toBe("3 O'CLOCK");
    expect(relativeClock(270, 90).label).toBe('BEHIND');
    expect(relativeClock(0, 90).label).toBe("9 O'CLOCK");
  });

  it('wraps across north', () => {
    expect(relativeClock(5, 355).label).toBe('AHEAD'); // 10° right: within 12 o'clock's ±15°
    expect(relativeClock(10, 350).hour).toBe(1); // 20° right is nearer 1 o'clock
    expect(relativeClock(350, 10).hour).toBe(11);
  });

  it('is nothing without both angles', () => {
    expect(relativeClock(NaN, 0)).toBeNull();
    expect(relativeClock(0, undefined)).toBeNull();
  });
});

describe('continuousAngle', () => {
  it('always turns the short way round', () => {
    expect(continuousAngle(359, 1)).toBe(361); // +2°, not -358°
    expect(continuousAngle(1, 359)).toBe(-1);
    expect(continuousAngle(720, 90)).toBe(810); // stays on the unwrapped scale
    expect(continuousAngle(10, 190)).toBe(190); // exactly opposite: either way is fine
  });

  it('starts from the target when there is no previous angle, and keeps it on bad input', () => {
    expect(continuousAngle(null, 370)).toBe(10);
    expect(continuousAngle(45, NaN)).toBe(45);
  });
});

describe('freshness', () => {
  const now = 1_000_000;
  it('grades how recently a member was heard from', () => {
    expect(freshness(now - 3_000, now)).toEqual({ text: 'LIVE', level: 'live' });
    expect(freshness(now - 42_000, now)).toEqual({ text: '42s AGO', level: 'recent' });
    expect(freshness(now - 150_000, now)).toEqual({ text: '2m AGO', level: 'stale' });
    expect(freshness(now - 900_000, now)).toEqual({ text: '15m AGO', level: 'lost' });
    expect(freshness(null, now)).toEqual({ text: 'NO SIGNAL YET', level: 'none' });
  });

  it('never goes negative when clocks disagree', () => {
    expect(freshness(now + 5_000, now).text).toBe('LIVE');
  });
});

describe('formatMetres', () => {
  it('reads in metres, then kilometres', () => {
    expect(formatMetres(349.6)).toEqual({ value: '350', unit: 'M' });
    expect(formatMetres(1250)).toEqual({ value: '1.3', unit: 'KM' });
    expect(formatMetres(12_400)).toEqual({ value: '12', unit: 'KM' });
    expect(formatMetres(undefined)).toBeNull();
  });
});

describe('sortByDistance', () => {
  const me = { lat: 12.8249, lng: 80.0452 };
  const far = { id: 'far', hasFix: true, lat: 12.84, lng: 80.06 };
  const near = { id: 'near', hasFix: true, lat: 12.825, lng: 80.0453 };
  const mid = { id: 'mid', hasFix: true, lat: 12.83, lng: 80.05 };
  const noFix = { id: 'nofix', hasFix: false, lat: null, lng: null };

  it('puts the nearest first and members without a fix last', () => {
    expect(sortByDistance([noFix, far, near, mid], me).map((m) => m.id)).toEqual(['near', 'mid', 'far', 'nofix']);
  });

  it('leaves the order alone when this phone has no position, and never mutates', () => {
    const input = [far, near];
    expect(sortByDistance(input, null).map((m) => m.id)).toEqual(['far', 'near']);
    sortByDistance(input, me);
    expect(input.map((m) => m.id)).toEqual(['far', 'near']);
  });
});
