import { describe, it, expect } from 'vitest';
import {
  resolveSosRoom,
  recordSos,
  toSosPayload,
  pendingSosFor,
  ackSos,
  memberKey,
  SOS_TTL_MS,
} from '../backend/sosRelay.js';

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

describe('memberKey', () => {
  it('prefers the stable uid over the per-connection socket id', () => {
    expect(memberKey('uid-1', 'sock-1')).toBe('uid-1');
    expect(memberKey(null, 'sock-1')).toBe('sock-1');
    expect(memberKey(undefined, 'sock-1')).toBe('sock-1');
  });
});

describe('SOS lifecycle (recordSos / pendingSosFor / ackSos)', () => {
  const T0 = 1_000_000;
  const fire = (squad, over = {}, now = T0) =>
    recordSos(
      squad,
      { senderKey: 'uB', senderId: 'sock-b', senderName: 'Bravo', lat: 12.8, lng: 80.0, timestamp: 42, ...over },
      now
    );

  it('records an SOS on the squad with a unique id and no acknowledgements', () => {
    const squad = { members: ['a', 'b'] };
    const one = fire(squad);
    const two = fire(squad, { senderKey: 'uC', senderId: 'sock-c' });
    expect(one.id).toBeTruthy();
    expect(one.id).not.toBe(two.id);
    expect(one.ackedBy).toEqual([]);
    expect(Object.keys(squad.sos)).toEqual(['uB', 'uC']);
  });

  it('keeps missing coordinates/name as null rather than undefined', () => {
    const sos = fire({}, { lat: undefined, lng: undefined, senderName: undefined });
    expect(sos.lat).toBeNull();
    expect(sos.lng).toBeNull();
    expect(sos.senderName).toBeNull();
  });

  it('falls back to `now` when the sender supplies no timestamp', () => {
    expect(fire({}, { timestamp: undefined }, T0).timestamp).toBe(T0);
  });

  it('replaces a sender\'s earlier SOS: newest wins, acknowledgements reset', () => {
    const squad = {};
    const first = fire(squad);
    ackSos(squad, first.id, 'uA');
    const second = fire(squad, {}, T0 + 5000);
    expect(Object.keys(squad.sos)).toHaveLength(1);
    expect(second.id).not.toBe(first.id);
    expect(pendingSosFor(squad, 'uA', T0 + 6000).map((s) => s.id)).toEqual([second.id]);
    // The superseded id can no longer be acknowledged.
    expect(ackSos(squad, first.id, 'uC')).toBe(false);
  });

  describe('pendingSosFor', () => {
    it('returns SOS the member has not acknowledged, oldest first', () => {
      const squad = {};
      const late = fire(squad, { senderKey: 'uC', senderId: 'sock-c' }, T0 + 2000);
      const early = fire(squad, {}, T0);
      expect(pendingSosFor(squad, 'uA', T0 + 3000).map((s) => s.id)).toEqual([early.id, late.id]);
    });

    it('never returns the member\'s own SOS', () => {
      const squad = {};
      fire(squad);
      expect(pendingSosFor(squad, 'uB', T0 + 1)).toEqual([]);
    });

    it('stops returning an SOS once that member acknowledges it, but not for others', () => {
      const squad = {};
      const sos = fire(squad);
      ackSos(squad, sos.id, 'uA');
      expect(pendingSosFor(squad, 'uA', T0 + 1)).toEqual([]);
      expect(pendingSosFor(squad, 'uC', T0 + 1).map((s) => s.id)).toEqual([sos.id]);
    });

    it('drops an SOS once it is older than the TTL, but not before', () => {
      const squad = {};
      fire(squad);
      expect(pendingSosFor(squad, 'uA', T0 + SOS_TTL_MS)).toHaveLength(1);
      expect(pendingSosFor(squad, 'uA', T0 + SOS_TTL_MS + 1)).toEqual([]);
      expect(squad.sos).toEqual({}); // and it was actually pruned, not just hidden
    });

    it('copes with a squad that has never had an SOS', () => {
      expect(pendingSosFor({}, 'uA')).toEqual([]);
      expect(pendingSosFor(undefined, 'uA')).toEqual([]);
    });
  });

  describe('ackSos', () => {
    it('is idempotent', () => {
      const squad = {};
      const sos = fire(squad);
      expect(ackSos(squad, sos.id, 'uA')).toBe(true);
      expect(ackSos(squad, sos.id, 'uA')).toBe(true);
      expect(sos.ackedBy).toEqual(['uA']);
    });

    it('rejects unknown ids and squads with no SOS', () => {
      const squad = {};
      fire(squad);
      expect(ackSos(squad, 'made-up', 'uA')).toBe(false);
      expect(ackSos(squad, undefined, 'uA')).toBe(false);
      expect(ackSos({}, 'x', 'uA')).toBe(false);
      expect(ackSos(undefined, 'x', 'uA')).toBe(false);
    });
  });

  describe('toSosPayload', () => {
    it('reports a live SOS as age 0 and a replayed one by how long ago it fired', () => {
      const sos = fire({}, {}, T0);
      expect(toSosPayload(sos, T0).ageMs).toBe(0);
      expect(toSosPayload(sos, T0 + 90_000).ageMs).toBe(90_000);
    });

    it('never goes negative if the clock steps backwards', () => {
      expect(toSosPayload(fire({}, {}, T0), T0 - 500).ageMs).toBe(0);
    });

    it('exposes only what the client needs (no acknowledgement list or stable uid)', () => {
      const payload = toSosPayload(fire({}), T0);
      expect(Object.keys(payload).sort()).toEqual(
        ['ageMs', 'id', 'lat', 'lng', 'senderId', 'senderName', 'timestamp']
      );
    });
  });
});
