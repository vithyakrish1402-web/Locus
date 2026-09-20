import { describe, it, expect } from 'vitest';
import {
  isKnownMember,
  rememberMember,
  forgetMember,
  rebindReturningMember,
} from '../backend/squadRoster.js';

// Alpha owns the squad; Bravo and Charlie were approved onto it.
const squad = () => ({
  ownerId: 'sock-a',
  ownerUid: 'uA',
  members: ['sock-a', 'sock-b', 'sock-c'],
  memberUids: { 'sock-a': 'uA', 'sock-b': 'uB', 'sock-c': 'uC' },
  knownUids: ['uA', 'uB', 'uC'],
});

describe('known members', () => {
  it('remembers a uid once, however many times it is admitted', () => {
    const s = {};
    rememberMember(s, 'uX');
    rememberMember(s, 'uX');
    expect(s.knownUids).toEqual(['uX']);
    expect(isKnownMember(s, 'uX')).toBe(true);
  });

  it('never remembers a missing uid (null would otherwise "match" every anonymous joiner)', () => {
    const s = {};
    rememberMember(s, null);
    rememberMember(s, undefined);
    rememberMember(s, '');
    expect(s.knownUids ?? []).toEqual([]);
    expect(isKnownMember({ knownUids: [null] }, null)).toBe(false);
  });

  it('forgets a uid, and only that one', () => {
    const s = squad();
    forgetMember(s, 'uB');
    expect(s.knownUids).toEqual(['uA', 'uC']);
    expect(isKnownMember(s, 'uB')).toBe(false);
  });

  it('copes with squads that have no roster yet', () => {
    expect(isKnownMember(undefined, 'uA')).toBe(false);
    expect(isKnownMember({}, 'uA')).toBe(false);
    expect(() => forgetMember({}, 'uA')).not.toThrow();
    expect(() => forgetMember(undefined, 'uA')).not.toThrow();
  });
});

describe('rebindReturningMember', () => {
  it('readmits a known member as MEMBER, moving them onto the new socket', () => {
    const s = squad();
    const result = rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' });

    expect(result).toEqual({ role: 'MEMBER', staleIds: ['sock-b'] });
    expect(s.members).toEqual(['sock-a', 'sock-c', 'sock-b2']);
    expect(s.memberUids).toEqual({ 'sock-a': 'uA', 'sock-c': 'uC', 'sock-b2': 'uB' });
  });

  it('leaves ownership alone when a plain member returns', () => {
    const s = squad();
    rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' });
    expect(s.ownerId).toBe('sock-a');
    expect(s.ownerUid).toBe('uA');
  });

  it('returns null for someone who was never approved (they go through the Commander)', () => {
    const s = squad();
    const before = JSON.stringify(s);
    expect(rebindReturningMember(s, { uid: 'uStranger', socketId: 'sock-x' })).toBeNull();
    expect(rebindReturningMember(s, { uid: null, socketId: 'sock-x' })).toBeNull();
    expect(rebindReturningMember(s, { uid: undefined, socketId: 'sock-x' })).toBeNull();
    expect(JSON.stringify(s)).toBe(before); // and it changed nothing
  });

  it('returns null for someone who left or was kicked (forgotten)', () => {
    const s = squad();
    forgetMember(s, 'uB');
    expect(rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' })).toBeNull();
    expect(s.members).not.toContain('sock-b2');
  });

  it('still recognises a member the stale sweep already pruned from `members`', () => {
    // The 60s sweep drops dead socket ids from `members`. Membership must not depend on
    // that list, or anyone offline for a minute would need approving all over again.
    const s = squad();
    s.members = s.members.filter((id) => id !== 'sock-b');

    const result = rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' });
    expect(result).toEqual({ role: 'MEMBER', staleIds: ['sock-b'] });
    expect(s.members).toEqual(['sock-a', 'sock-c', 'sock-b2']);
  });

  it('still recognises a member even if nothing is left of their old socket at all', () => {
    const s = squad();
    s.members = s.members.filter((id) => id !== 'sock-b');
    delete s.memberUids['sock-b'];

    const result = rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' });
    expect(result).toEqual({ role: 'MEMBER', staleIds: [] });
    expect(s.members).toContain('sock-b2');
    expect(s.memberUids['sock-b2']).toBe('uB');
  });

  it('sweeps up every earlier socket of the same person, not just the latest', () => {
    const s = squad();
    s.members.push('sock-b-older');
    s.memberUids['sock-b-older'] = 'uB';

    const result = rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b3' });
    expect(result.staleIds.sort()).toEqual(['sock-b', 'sock-b-older']);
    expect(s.members.filter((id) => id === 'sock-b3')).toHaveLength(1);
    expect(s.members).not.toContain('sock-b');
    expect(s.members).not.toContain('sock-b-older');
  });

  it('never touches other members\' sockets', () => {
    const s = squad();
    rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' });
    expect(s.members).toEqual(expect.arrayContaining(['sock-a', 'sock-c']));
    expect(s.memberUids['sock-a']).toBe('uA');
    expect(s.memberUids['sock-c']).toBe('uC');
  });

  it('is idempotent: rebinding the socket they are already on changes nothing', () => {
    const s = squad();
    rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' });
    const after = JSON.stringify(s);
    expect(rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' })).toEqual({
      role: 'MEMBER',
      staleIds: [],
    });
    expect(JSON.stringify(s)).toBe(after);
  });

  describe('a member who had been promoted to owner', () => {
    // When the Commander leaves, succession makes members[0] the owner — by socket id
    // only. If that promoted member reconnects, they must come back as the owner, not as
    // a plain member of a squad whose "owner" is a socket that no longer exists.
    const promoted = () => {
      const s = squad();
      s.ownerId = 'sock-b';
      return s;
    };

    it('comes back as OWNER, and ownership follows them to the new socket', () => {
      const s = promoted();
      const result = rebindReturningMember(s, { uid: 'uB', socketId: 'sock-b2' });
      expect(result.role).toBe('OWNER');
      expect(s.ownerId).toBe('sock-b2');
      expect(s.ownerUid).toBe('uB');
    });

    it('does not hand ownership to a different member who merely returns', () => {
      const s = promoted();
      const result = rebindReturningMember(s, { uid: 'uC', socketId: 'sock-c2' });
      expect(result.role).toBe('MEMBER');
      expect(s.ownerId).toBe('sock-b');
    });
  });
});
