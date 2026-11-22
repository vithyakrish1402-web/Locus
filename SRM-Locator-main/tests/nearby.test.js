import { describe, it, expect } from 'vitest';
import {
  NEARBY_RADIUS_M, NEARBY_MAX_FIX_AGE_MS, NEARBY_INVITE_TTL_MS, nearbyEnabled, nearbyTimings,
  distanceM, cleanFix, isNearby, createInviteBook,
  NEARBY_CARETAKER_WAIT_MS, noteNearbyAdmission, forgetNearbyAdmission, tooNewToStandIn,
} from '../backend/nearby.js';

// One metre of latitude, near SRM (12.82 N).
const M = 1 / 111_320;
const HERE = { lat: 12.8231, lng: 80.0442 };
const fix = (northM, accuracy = 5, at = 1000) => ({ lat: HERE.lat + northM * M, lng: HERE.lng, accuracy, at });

describe('the constants', () => {
  it('are 15 m, 20 s and 2 minutes', () => {
    expect(NEARBY_RADIUS_M).toBe(15);
    expect(NEARBY_MAX_FIX_AGE_MS).toBe(20_000);
    expect(NEARBY_INVITE_TTL_MS).toBe(120_000);
  });

  it('Nearby is off unless switched on with "true"', () => {
    expect(nearbyEnabled({})).toBe(false);
    expect(nearbyEnabled({ LOCUS_NEARBY_ENABLED: '1' })).toBe(false);
    expect(nearbyEnabled({ LOCUS_NEARBY_ENABLED: 'true' })).toBe(true);
  });

  it('the test timings are ignored in production', () => {
    const DAY = 24 * 60 * 60 * 1000;
    expect(nearbyTimings({})).toEqual({ inviteTtlMs: 120_000, maxFixAgeMs: 20_000, caretakerWaitMs: DAY });
    expect(nearbyTimings({ LOCUS_NEARBY_INVITE_TTL_MS: '300', LOCUS_NEARBY_MAX_FIX_AGE_MS: '400', LOCUS_NEARBY_CARETAKER_WAIT_MS: '500' }))
      .toEqual({ inviteTtlMs: 300, maxFixAgeMs: 400, caretakerWaitMs: 500 });
    expect(nearbyTimings({ LOCUS_NEARBY_INVITE_TTL_MS: '300', LOCUS_NEARBY_CARETAKER_WAIT_MS: '500', NODE_ENV: 'production' }))
      .toEqual({ inviteTtlMs: 120_000, maxFixAgeMs: 20_000, caretakerWaitMs: DAY });
  });
});

describe('the distance rule', () => {
  it('measures metres', () => {
    expect(distanceM(fix(0), fix(10))).toBeCloseTo(10, 1);
  });

  it('lists someone 14 m away with good fixes, not someone 16 m away', () => {
    expect(isNearby(fix(0), fix(14), 1000)).toBe(true);
    expect(isNearby(fix(0), fix(15), 1000)).toBe(true);
    expect(isNearby(fix(0), fix(16), 1000)).toBe(false);
  });

  it('needs both accuracies known and within 15 m', () => {
    expect(isNearby(fix(0, 15), fix(5, 15), 1000)).toBe(true);
    expect(isNearby(fix(0, 15.1), fix(5), 1000)).toBe(false);
    expect(isNearby(fix(0), fix(5, 16), 1000)).toBe(false);
    expect(isNearby(fix(0), fix(5, null), 1000)).toBe(false);
    expect(isNearby({ ...fix(0), accuracy: undefined }, fix(5), 1000)).toBe(false);
    expect(isNearby(fix(0), fix(5, 0), 1000)).toBe(false);
  });

  it('needs both positions fresher than 20 s', () => {
    expect(isNearby(fix(0, 5, 0), fix(5, 5, 0), 20_000)).toBe(true);
    expect(isNearby(fix(0, 5, 0), fix(5, 5, 1000), 20_001)).toBe(false);
    expect(isNearby(fix(0, 5, 1000), fix(5, 5, 0), 20_001)).toBe(false);
    expect(isNearby(fix(0, 5, 0), fix(5, 5, 0), 30_000, { maxAgeMs: 40_000 })).toBe(true);
  });

  it('refuses positions that are no positions, or from the future', () => {
    expect(isNearby(fix(0), null, 1000)).toBe(false);
    expect(isNearby(fix(0), { lat: 'x', lng: 1, accuracy: 5, at: 1000 }, 1000)).toBe(false);
    expect(isNearby(fix(0), { ...fix(5), at: undefined }, 1000)).toBe(false);
    expect(isNearby(fix(0), fix(5, 5, 9000), 1000)).toBe(false);
  });

  it('cleans a phone report into a fix, with no accuracy when it sent none', () => {
    expect(cleanFix({ lat: 1, lng: 2, accuracy: 7 }, 5)).toEqual({ lat: 1, lng: 2, accuracy: 7, at: 5 });
    expect(cleanFix({ lat: 1, lng: 2 }, 5)).toEqual({ lat: 1, lng: 2, accuracy: null, at: 5 });
    expect(cleanFix({ lat: 91, lng: 2 }, 5)).toBeNull();
    expect(cleanFix(undefined, 5)).toBeNull();
  });
});

describe('the invite book', () => {
  it('keeps one open invite per person per Group, and inviting again does not extend it', () => {
    const book = createInviteBook({ ttlMs: 100 });
    const first = book.offer({ roomCode: 'G', uid: 'u' }, 0);
    expect(first.created).toBe(true);
    const again = book.offer({ roomCode: 'G', uid: 'u' }, 50);
    expect(again).toEqual({ invite: first.invite, created: false });
    expect(again.invite.expiresAt).toBe(100);
    expect(book.offer({ roomCode: 'H', uid: 'u' }, 50).created).toBe(true);
  });

  it('is used once; a second answer is told it was used', () => {
    const book = createInviteBook({ ttlMs: 100 });
    const { invite } = book.offer({ roomCode: 'G', uid: 'u' }, 0);
    expect(book.use(invite.id, 'u', 10)).toMatchObject({ ok: true });
    expect(book.use(invite.id, 'u', 11)).toEqual({ ok: false, reason: 'used' });
  });

  it('refuses an expired invite, and one that is not theirs', () => {
    const book = createInviteBook({ ttlMs: 100 });
    const { invite } = book.offer({ roomCode: 'G', uid: 'u' }, 0);
    expect(book.use(invite.id, 'someone-else', 10)).toEqual({ ok: false, reason: 'no-invite' });
    expect(book.use(invite.id, 'u', 100)).toEqual({ ok: false, reason: 'expired' });
    expect(book.use('nope', 'u', 10)).toEqual({ ok: false, reason: 'no-invite' });
  });

  it('a new invite may be made once the last was used or ran out', () => {
    const book = createInviteBook({ ttlMs: 100 });
    const { invite } = book.offer({ roomCode: 'G', uid: 'u' }, 0);
    book.use(invite.id, 'u', 1);
    expect(book.offer({ roomCode: 'G', uid: 'u' }, 2).created).toBe(true);
    expect(book.offer({ roomCode: 'G', uid: 'v' }, 0).created).toBe(true);
    expect(book.offer({ roomCode: 'G', uid: 'v' }, 100).created).toBe(true);
  });

  it('sweeps: reports each unanswered invite once, then forgets records after at least a minute', () => {
    const book = createInviteBook({ ttlMs: 100 });
    const a = book.offer({ roomCode: 'G', uid: 'a' }, 0).invite;
    const b = book.offer({ roomCode: 'G', uid: 'b' }, 0).invite;
    book.use(b.id, 'b', 1);
    expect(book.sweep(99)).toEqual([]);
    expect(book.sweep(100).map((i) => i.id)).toEqual([a.id]);
    expect(book.sweep(150)).toEqual([]);
    // Still a record: a late answer hears why.
    expect(book.use(a.id, 'a', 150)).toEqual({ ok: false, reason: 'expired' });
    expect(book.use(b.id, 'b', 150)).toEqual({ ok: false, reason: 'used' });
    // And no longer open: they can be invited again.
    expect(book.offer({ roomCode: 'G', uid: 'a' }, 150).created).toBe(true);
    book.sweep(60_099);
    expect(book.use(b.id, 'b', 60_099)).toEqual({ ok: false, reason: 'used' });
    book.sweep(60_100);
    expect(book.use(b.id, 'b', 60_101)).toEqual({ ok: false, reason: 'no-invite' });
  });
});

describe('standing in, for someone admitted through Nearby', () => {
  it('waits 24 hours', () => expect(NEARBY_CARETAKER_WAIT_MS).toBe(24 * 60 * 60 * 1000));

  it('is not allowed until the wait is over, then is', () => {
    const squad = {};
    noteNearbyAdmission(squad, 'u', 1000);
    expect(tooNewToStandIn(squad, 'u', 1000 + NEARBY_CARETAKER_WAIT_MS - 1)).toBe(true);
    expect(tooNewToStandIn(squad, 'u', 1000 + NEARBY_CARETAKER_WAIT_MS)).toBe(false);
  });

  it('never applies to anyone else, or after a usual approval', () => {
    const squad = {};
    expect(tooNewToStandIn(squad, 'v', 0)).toBe(false);
    expect(tooNewToStandIn(undefined, 'v', 0)).toBe(false);
    noteNearbyAdmission(squad, 'u', 0);
    forgetNearbyAdmission(squad, 'u');
    expect(tooNewToStandIn(squad, 'u', 1)).toBe(false);
  });
});
