import { describe, it, expect } from 'vitest';
import {
  leaseSeconds, setPresence, presenceOf, livePresence, hasPresence, removePresence, expirePresence,
  groupMembers, liveUids, presenceKey, uidOfPresenceKey, LEASE_MIN_SEC, LEASE_MAX_SEC,
} from '../backend/presence.js';
import { refuseJoin } from '../backend/squadRoster.js';

/** Presence by uid (backend/presence.js), on its own: no sockets, no clock. */

const NOW = 1_000_000;
const squadOf = (over = {}) => ({ knownUids: ['uA', 'uB'], blockedUids: [], members: [], memberUids: {}, ...over });
const here = { lat: 12.82, lng: 80.04 };

describe('the lease', () => {
  it('is three times what the phone said its next report would be within', () => {
    expect(leaseSeconds(100, 60, 900)).toBe(300);
    expect(leaseSeconds(30, 60, 900)).toBe(90);
    expect(leaseSeconds(250, 60, 900)).toBe(750);
  });

  it('is never less than the minimum, however eager the phone', () => {
    expect(leaseSeconds(5, 60, 900)).toBe(60);
    expect(leaseSeconds(20, 60, 900)).toBe(60); // 3 x 20 is exactly the minimum
    expect(leaseSeconds(20.1, 60, 900)).toBeCloseTo(60.3);
  });

  it('is never more than the maximum, however long the phone says it will be quiet', () => {
    expect(leaseSeconds(300, 60, 900)).toBe(900);
    expect(leaseSeconds(301, 60, 900)).toBe(900);
    expect(leaseSeconds(1e9, 60, 900)).toBe(900);
    expect(leaseSeconds(Infinity, 60, 900)).toBe(60); // not a number it can use
  });

  it('is the minimum when the phone said nothing sensible', () => {
    for (const bad of [undefined, null, NaN, -5, 0, '120', {}, [], true]) expect(leaseSeconds(bad, 60, 900)).toBe(60);
  });

  it('defaults to 60 s and 900 s', () => {
    expect([LEASE_MIN_SEC, LEASE_MAX_SEC]).toEqual([60, 900]);
    expect(leaseSeconds(100)).toBe(300);
  });
});

describe('who can hold a place', () => {
  it('an admitted person can, and their report is kept as given', () => {
    const squad = squadOf();
    const entry = setPresence(squad, 'uA', { ...here, speed: 3, heading: 90, battery: 55, status: 'FROZEN', name: 'Asha', photo: 'p.png', nextPostWithinSec: 100 }, NOW);
    expect(entry).toEqual({
      uid: 'uA', name: 'Asha', photo: 'p.png', lat: 12.82, lng: 80.04, speed: 3, heading: 90, battery: 55, accuracy: null,
      status: 'FROZEN', lastSeen: NOW, leaseUntil: NOW + 300000,
    });
    expect(squad.presence.uA).toBe(entry);
  });

  it('a stranger cannot', () => {
    const squad = squadOf();
    expect(setPresence(squad, 'uZ', here, NOW)).toBeNull();
    expect(squad.presence).toBeUndefined();
  });

  it('a blocked person cannot, even if they were admitted before', () => {
    const squad = squadOf({ blockedUids: ['uA'] });
    expect(setPresence(squad, 'uA', here, NOW)).toBeNull();
  });

  it('nobody can without a position, or a made-up uid', () => {
    const squad = squadOf();
    for (const report of [undefined, null, {}, { lat: 1 }, { lat: 1, lng: NaN }, { lat: '12', lng: '80' }, { lat: Infinity, lng: 1 }]) {
      expect(setPresence(squad, 'uA', report, NOW)).toBeNull();
    }
    for (const uid of [undefined, null, '', 7, {}]) expect(setPresence(squad, uid, here, NOW)).toBeNull();
    expect(setPresence(null, 'uA', here, NOW)).toBeNull();
    expect(squad.presence).toBeUndefined();
  });

  it('an odd uid is not a way into the object\'s own properties', () => {
    const squad = squadOf({ knownUids: ['__proto__', 'constructor'] });
    expect(setPresence(squad, '__proto__', here, NOW)).not.toBeNull();
    expect(setPresence(squad, 'constructor', here, NOW)).not.toBeNull();
    expect({}.lat).toBeUndefined();
    expect(Object.keys(squad.presence).sort()).toEqual(['__proto__', 'constructor']);
    expect(presenceOf(squad, 'toString', NOW)).toBeNull();
  });

  it('takes name and photo from what the Group knows of them when the report has none', () => {
    const squad = squadOf({ profiles: { uA: { name: 'Asha', photo: 'a.png' } } });
    expect(setPresence(squad, 'uA', here, NOW)).toMatchObject({ name: 'Asha', photo: 'a.png' });
    expect(setPresence(squad, 'uA', { ...here, name: 'Asha K' }, NOW)).toMatchObject({ name: 'Asha K', photo: 'a.png' });
    expect(setPresence(squadOf(), 'uB', here, NOW)).toMatchObject({ name: null, photo: null });
  });

  it('keeps only sensible extras: numbers as numbers, a known status, no other fields', () => {
    const entry = setPresence(squadOf(), 'uA', { ...here, speed: 'fast', heading: NaN, battery: null, status: 'HACKED', name: 5, evil: 'x' }, NOW);
    expect(entry).toMatchObject({ speed: 0, heading: 0, battery: 0, status: 'ACTIVE', name: null });
    expect(entry).not.toHaveProperty('evil');
  });

  it('a new report replaces the old one and renews the lease', () => {
    const squad = squadOf();
    setPresence(squad, 'uA', here, NOW);
    const later = setPresence(squad, 'uA', { lat: 13, lng: 81 }, NOW + 50000);
    expect(Object.keys(squad.presence)).toEqual(['uA']);
    expect(later).toMatchObject({ lat: 13, lastSeen: NOW + 50000, leaseUntil: NOW + 50000 + 60000 });
  });
});

describe('a running lease', () => {
  const squad = () => {
    const s = squadOf();
    setPresence(s, 'uA', here, NOW); // 60 s
    return s;
  };

  it('holds up to its last moment and not at it', () => {
    const s = squad();
    expect(presenceOf(s, 'uA', NOW)).not.toBeNull();
    expect(presenceOf(s, 'uA', NOW + 59999)).not.toBeNull();
    expect(presenceOf(s, 'uA', NOW + 60000)).toBeNull();
    expect(hasPresence(s, NOW + 59999)).toBe(true);
    expect(hasPresence(s, NOW + 60000)).toBe(false);
    expect(livePresence(s, NOW + 60000)).toEqual([]);
  });

  it('is ended by removing it', () => {
    const s = squad();
    expect(removePresence(s, 'uA')).toBe(true);
    expect(presenceOf(s, 'uA', NOW)).toBeNull();
    expect(removePresence(s, 'uA')).toBe(false);
    expect(removePresence(s, 'nobody')).toBe(false);
    expect(removePresence({}, 'uA')).toBe(false);
  });

  it('is collected when it runs out, and only then', () => {
    const s = squadOf();
    setPresence(s, 'uA', here, NOW); // runs out at NOW + 60000
    setPresence(s, 'uB', { ...here, nextPostWithinSec: 100 }, NOW); // at NOW + 300000
    expect(expirePresence(s, NOW + 59999)).toEqual([]);
    const gone = expirePresence(s, NOW + 60000);
    expect(gone.map((e) => e.uid)).toEqual(['uA']);
    expect(Object.keys(s.presence)).toEqual(['uB']);
    expect(expirePresence(s, NOW + 60000)).toEqual([]);
    expect(expirePresence(s, NOW + 300000).map((e) => e.uid)).toEqual(['uB']);
    expect(hasPresence(s, NOW)).toBe(false);
  });

  it('copes with a squad that never had any', () => {
    expect(expirePresence({}, NOW)).toEqual([]);
    expect(expirePresence(undefined, NOW)).toEqual([]);
    expect(hasPresence({}, NOW)).toBe(false);
    expect(presenceOf(undefined, 'uA', NOW)).toBeNull();
  });
});

describe('who is in the Group', () => {
  const isLive = (id) => id !== 'dead';

  it('lists everyone admitted, saying who is connected and who is sharing', () => {
    const squad = squadOf({
      knownUids: ['uA', 'uB', 'uC', 'uD'],
      members: ['s1', 'dead', 's3'],
      memberUids: { s1: 'uA', dead: 'uB', s3: 'uC' },
    });
    setPresence(squad, 'uB', here, NOW); // swiped away: sharing, no connection
    setPresence(squad, 'uC', here, NOW); // connected AND sharing
    const byUid = Object.fromEntries(groupMembers(squad, NOW, isLive).map((m) => [m.uid, m]));
    expect(Object.keys(byUid).sort()).toEqual(['uA', 'uB', 'uC', 'uD']);
    expect(byUid.uA).toMatchObject({ live: true, socketId: 's1', present: false });
    expect(byUid.uB).toMatchObject({ live: false, socketId: null, present: true });
    expect(byUid.uC).toMatchObject({ live: true, socketId: 's3', present: true });
    expect(byUid.uD).toMatchObject({ live: false, present: false, presence: null });
    expect(byUid.uB.presence).toMatchObject({ lat: 12.82 });
  });

  it('does not count a lease that has run out', () => {
    const squad = squadOf();
    setPresence(squad, 'uA', here, NOW);
    expect(groupMembers(squad, NOW + 60000, isLive).find((m) => m.uid === 'uA').present).toBe(false);
  });

  it('lists live and sharing people even if the admitted list somehow lacks them, once each', () => {
    const squad = squadOf({ knownUids: [], members: ['s1'], memberUids: { s1: 'uA' } });
    squad.presence = Object.create(null);
    squad.presence.uA = { uid: 'uA', leaseUntil: NOW + 1000 };
    squad.presence.uZ = { uid: 'uZ', leaseUntil: NOW + 1000 };
    const all = groupMembers(squad, NOW, isLive);
    expect(all.map((m) => m.uid).sort()).toEqual(['uA', 'uZ']);
  });

  it('names the uids with a connection', () => {
    const squad = squadOf({ members: ['s1', 'dead', 's3', 's4'], memberUids: { s1: 'uA', dead: 'uB', s3: 'uC' } });
    expect([...liveUids(squad, isLive)].sort()).toEqual(['uA', 'uC']); // s4 has no uid
    expect([...liveUids({}, isLive)]).toEqual([]);
  });

  it('copes with a hundred people', () => {
    const uids = Array.from({ length: 100 }, (_, i) => `u${i}`);
    const squad = squadOf({ knownUids: uids });
    uids.forEach((uid) => setPresence(squad, uid, here, NOW));
    expect(groupMembers(squad, NOW, isLive)).toHaveLength(100);
    expect(expirePresence(squad, NOW + 60000)).toHaveLength(100);
  });
});

describe('the roster key of someone with no socket', () => {
  it('cannot be mistaken for a socket id, and can be turned back into a uid', () => {
    expect(presenceKey('uA')).toBe('bg:uA');
    expect(uidOfPresenceKey('bg:uA')).toBe('uA');
    expect(uidOfPresenceKey('bg:u:A')).toBe('u:A');
    for (const notOurs of ['uA', 'bg:', 'BG:uA', ' bg:uA', undefined, null, 7, {}]) expect(uidOfPresenceKey(notOurs)).toBeNull();
  });
});

describe('a squad held open by people sharing from the background', () => {
  const live = () => true;

  it('is still there to be joined, which the usual rule would say it is not', () => {
    const empty = { members: [], ownerUid: 'uA', commanderUid: 'uA' };
    expect(refuseJoin(empty, { intent: 'join', uid: 'uZ', isSocketLive: live })).toBe('squad-not-found');
    expect(refuseJoin(empty, { intent: 'join', uid: 'uZ', isSocketLive: live, holdsPresence: true })).toBeNull();
  });

  it('is taken as far as a new squad under its code goes, except by its own Commander', () => {
    const empty = { members: [], ownerUid: 'uA', commanderUid: 'uA' };
    expect(refuseJoin(empty, { intent: 'create', uid: 'uZ', isSocketLive: live })).toBeNull();
    expect(refuseJoin(empty, { intent: 'create', uid: 'uZ', isSocketLive: live, holdsPresence: true })).toBe('squad-code-taken');
    expect(refuseJoin(empty, { intent: 'create', uid: 'uA', isSocketLive: live, holdsPresence: true })).toBeNull();
  });

  it('changes nothing for a squad without any, or for a code with no squad at all', () => {
    const busy = { members: ['s1'], ownerUid: 'uA', commanderUid: 'uA' };
    expect(refuseJoin(busy, { intent: 'join', uid: 'uZ', isSocketLive: live })).toBeNull();
    expect(refuseJoin(busy, { intent: 'create', uid: 'uZ', isSocketLive: live })).toBe('squad-code-taken');
    expect(refuseJoin(undefined, { intent: 'join', uid: 'uZ' })).toBe('squad-not-found');
    expect(refuseJoin(undefined, { intent: 'create', uid: 'uZ' })).toBeNull();
  });
});
