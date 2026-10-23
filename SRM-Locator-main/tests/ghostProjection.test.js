import { describe, it, expect } from 'vitest';
import { deriveGhostMembers, getGhostPhase, GHOST_EXPIRE_SECONDS, formatElapsed } from '../src/utils/ghostProjection.js';

// Item 10 of the 2026-10 bug batch: a member whose connection is lost stays at their last known
// location. Nothing about their speed or heading moves them (it used to, for up to 90 s).
describe('deriveGhostMembers', () => {
  const ghost = { id: 'g', lat: 12.82, lng: 80.04, speedKmh: 25, heading: 45, timeDelta: 30, receivedAt: 1_000_000 };

  it('puts them at their last known location, however long they are gone and however fast they moved', () => {
    for (const seconds of [0, 10, 89, 91, 121, 3600]) {
      const [g] = deriveGhostMembers({ g: ghost }, ghost.receivedAt + seconds * 1000);
      expect(g.position).toEqual({ lat: 12.82, lng: 80.04 });
      expect(g.lastKnownLocation).toEqual({ lat: 12.82, lng: 80.04 });
    }
  });

  it('says how long, and when it has been long enough to say "last seen"', () => {
    expect(getGhostPhase(GHOST_EXPIRE_SECONDS)).toBe('lost');
    expect(getGhostPhase(GHOST_EXPIRE_SECONDS + 1)).toBe('expired');
    const [g] = deriveGhostMembers({ g: ghost }, ghost.receivedAt + 75_000);
    expect(g.elapsedLabel).toBe('1:15');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});
