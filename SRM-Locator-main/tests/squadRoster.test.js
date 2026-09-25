import { describe, it, expect } from 'vitest';
import {
  isKnownMember,
  rememberMember,
  forgetMember,
  rebindReturningMember,
  collectStaleSocketIds,
  refuseJoin,
  addPendingRequest,
  takePendingRequest,
  withdrawPendingRequests,
  pendingRequestsOf,
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

// Every connection a person has been seen on except the one they are arriving on now.
// Callers tear these down; miss one and that dead socket stays on everyone's map as a
// second, frozen copy of a member who is in fact right here.
describe('superseded connections', () => {
  it("finds the same person's earlier sockets, and only theirs", () => {
    const s = squad();
    expect(collectStaleSocketIds(s, 'uB', 'sock-b2')).toEqual(['sock-b']);
  });

  it('never reports the socket they are arriving on', () => {
    const s = squad();
    expect(collectStaleSocketIds(s, 'uB', 'sock-b')).toEqual([]);
  });

  it('collects several, for someone who reconnected more than once', () => {
    const s = squad();
    s.memberUids['sock-b-old'] = 'uB';
    expect(collectStaleSocketIds(s, 'uB', 'sock-b2').sort()).toEqual(['sock-b', 'sock-b-old']);
  });

  it("picks up the owner's previous socket even when memberUids has lost track of it", () => {
    // The owner-reconnect path relies on this: an older squad, or one whose ownership
    // changed hands, can carry an ownerId that memberUids no longer maps.
    const s = squad();
    delete s.memberUids['sock-a'];
    expect(collectStaleSocketIds(s, 'uA', 'sock-a2')).toEqual(['sock-a']);
  });

  it('returns nothing without a uid, rather than matching every anonymous socket', () => {
    const s = squad();
    s.memberUids['sock-anon'] = null;
    expect(collectStaleSocketIds(s, null, 'sock-x')).toEqual([]);
    expect(collectStaleSocketIds(s, undefined, 'sock-x')).toEqual([]);
  });
});

describe('what a join request means', () => {
  it('refuses a JOIN for a code with no live squad, instead of founding one', () => {
    expect(refuseJoin(undefined, { intent: 'join', uid: 'uX' })).toBe('squad-not-found');
    expect(refuseJoin({ ...squad(), members: [] }, { intent: 'join', uid: 'uX' })).toBe('squad-not-found');
    expect(refuseJoin(squad(), { intent: 'join', uid: 'uX' })).toBeNull();
  });

  it("refuses a CREATE for a live code, unless it comes from that squad's own Commander", () => {
    expect(refuseJoin(squad(), { intent: 'create', uid: 'uX' })).toBe('squad-code-taken');
    expect(refuseJoin(squad(), { intent: 'create', uid: null })).toBe('squad-code-taken');
    expect(refuseJoin(squad(), { intent: 'create', uid: 'uA' })).toBeNull();
    expect(refuseJoin(undefined, { intent: 'create', uid: 'uX' })).toBeNull();
  });

  it('treats a CREATE from the Commander as theirs while a stand-in holds command', () => {
    // Bravo stands in for Alpha. Alpha's retried CREATE is Alpha's squad coming back to
    // them, not a stranger's code: refusing it sent them to the lobby with a new code.
    const standIn = { ...squad(), ownerId: 'sock-b', ownerUid: 'uB', commanderUid: 'uA' };
    expect(refuseJoin(standIn, { intent: 'create', uid: 'uA' })).toBeNull();
    expect(refuseJoin(standIn, { intent: 'create', uid: 'uB' })).toBeNull();
    expect(refuseJoin(standIn, { intent: 'create', uid: 'uC' })).toBe('squad-code-taken');
  });

  it('refuses a JOIN for a squad whose members have all dropped off, before the sweep reaches it', () => {
    const allGone = () => false;
    expect(refuseJoin(squad(), { intent: 'join', uid: 'uX', isSocketLive: allGone })).toBe('squad-not-found');
    const onlyCharlie = (id) => id === 'sock-c';
    expect(refuseJoin(squad(), { intent: 'join', uid: 'uX', isSocketLive: onlyCharlie })).toBeNull();
    // A CREATE still counts it as taken: a new squad never inherits another's state.
    expect(refuseJoin(squad(), { intent: 'create', uid: 'uX', isSocketLive: allGone })).toBe('squad-code-taken');
    // And a Commander's resume is never refused.
    expect(refuseJoin(squad(), { intent: 'resume', uid: 'uA', isSocketLive: allGone })).toBeNull();
  });

  it('refuses nothing without an intent, or on a resume: every installed build is create-or-join', () => {
    for (const intent of [undefined, null, 'resume', 'something-else']) {
      expect(refuseJoin(undefined, { intent, uid: 'uX' })).toBeNull();
      expect(refuseJoin(squad(), { intent, uid: 'uX' })).toBeNull();
    }
  });
});

describe('join requests awaiting the Commander', () => {
  it('can only be decided once', () => {
    const s = squad();
    addPendingRequest(s, 'sock-x', { uid: 'uX', name: 'X', photo: null });
    expect(takePendingRequest(s, 'sock-x')).toEqual({ uid: 'uX', name: 'X', photo: null });
    expect(takePendingRequest(s, 'sock-x')).toBeNull();
  });

  it('cannot be decided for a socket that never asked', () => {
    const s = squad();
    expect(takePendingRequest(s, 'sock-x')).toBeNull();
    addPendingRequest(s, 'sock-x', { uid: 'uX' });
    expect(takePendingRequest(s, 'sock-y')).toBeNull();
    for (const bad of [undefined, null, 42, {}, '__proto__', 'constructor']) {
      expect(takePendingRequest(s, bad)).toBeNull();
    }
  });

  it('are withdrawn everywhere for a socket, and for the same person on an earlier socket', () => {
    const squads = { AAA: squad(), BBB: squad() };
    addPendingRequest(squads.AAA, 'sock-x', { uid: 'uX' });
    addPendingRequest(squads.BBB, 'sock-x-old', { uid: 'uX' });
    addPendingRequest(squads.BBB, 'sock-y', { uid: 'uY' });

    expect(withdrawPendingRequests(squads, { socketId: 'sock-x', uid: 'uX' })).toEqual([
      { roomCode: 'AAA', targetId: 'sock-x' },
      { roomCode: 'BBB', targetId: 'sock-x-old' },
    ]);
    expect(pendingRequestsOf(squads.BBB, 'BBB')).toEqual([{ targetId: 'sock-y', name: null, photo: null, roomCode: 'BBB' }]);
  });

  it('are withdrawn by socket only when no uid is given (another device of the same person keeps its own)', () => {
    const squads = { AAA: squad() };
    addPendingRequest(squads.AAA, 'sock-x', { uid: 'uX' });
    addPendingRequest(squads.AAA, 'sock-x-phone2', { uid: 'uX' });
    expect(withdrawPendingRequests(squads, { socketId: 'sock-x' })).toEqual([{ roomCode: 'AAA', targetId: 'sock-x' }]);
    expect(pendingRequestsOf(squads.AAA, 'AAA').map((r) => r.targetId)).toEqual(['sock-x-phone2']);
  });

  it('never match an anonymous joiner by a missing uid', () => {
    const squads = { AAA: squad() };
    addPendingRequest(squads.AAA, 'sock-anon', { uid: null });
    expect(withdrawPendingRequests(squads, { socketId: 'sock-z', uid: null })).toEqual([]);
  });

  it("are read back as the Commander's access-request payloads", () => {
    const s = squad();
    expect(pendingRequestsOf(s, 'AAA')).toEqual([]);
    addPendingRequest(s, 'sock-x', { uid: 'uX', name: 'X', photo: 'p.png' });
    expect(pendingRequestsOf(s, 'AAA')).toEqual([{ targetId: 'sock-x', name: 'X', photo: 'p.png', roomCode: 'AAA' }]);
  });
});
