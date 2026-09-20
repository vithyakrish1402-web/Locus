import { describe, it, expect } from 'vitest';
import { resolveSosRoom } from '../backend/sosRelay.js';

const squads = () => ({
  ALPHA1: { ownerId: 'a', members: ['a', 'b'] },
  BRAVO2: { ownerId: 'c', members: ['c'] },
});

describe('resolveSosRoom', () => {
  it('resolves a member who has no `users` entry yet (no GPS fix) from the roster', () => {
    // Regression: the old handler read users[socket.id]?.roomCode, which only exists
    // after update-location, so this member's SOS was silently dropped.
    expect(resolveSosRoom(squads(), {}, 'b', 'ALPHA1')).toBe('ALPHA1');
  });

  it('still resolves when the client sends no roomCode at all', () => {
    expect(resolveSosRoom(squads(), {}, 'b', undefined)).toBe('ALPHA1');
    expect(resolveSosRoom(squads(), {}, 'c', null)).toBe('BRAVO2');
  });

  it('prefers the room recorded in `users` when the roster confirms it', () => {
    const users = { b: { roomCode: 'ALPHA1' } };
    expect(resolveSosRoom(squads(), users, 'b', 'BRAVO2')).toBe('ALPHA1');
  });

  it('does not let a client claim a squad it is not a member of', () => {
    // b is only in ALPHA1; claiming BRAVO2 must not route the SOS there.
    expect(resolveSosRoom(squads(), {}, 'b', 'BRAVO2')).toBe('ALPHA1');
  });

  it('ignores a stale `users` room the sender has since been removed from', () => {
    const s = squads();
    s.ALPHA1.members = ['a']; // b was kicked
    const users = { b: { roomCode: 'ALPHA1' } };
    expect(resolveSosRoom(s, users, 'b', 'ALPHA1')).toBeNull();
  });

  it('returns null for a socket that is in no squad', () => {
    expect(resolveSosRoom(squads(), {}, 'stranger', 'ALPHA1')).toBeNull();
    expect(resolveSosRoom({}, {}, 'a', 'ALPHA1')).toBeNull();
  });

  it('is not fooled by prototype keys or non-string room codes', () => {
    expect(resolveSosRoom(squads(), {}, 'stranger', '__proto__')).toBeNull();
    expect(resolveSosRoom(squads(), {}, 'stranger', 'constructor')).toBeNull();
    expect(resolveSosRoom(squads(), {}, 'stranger', { toString: () => 'ALPHA1' })).toBeNull();
  });
});
