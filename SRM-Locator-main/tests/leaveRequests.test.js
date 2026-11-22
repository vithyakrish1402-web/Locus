import { describe, it, expect } from 'vitest';
import {
  LEAVE_AUTO_APPROVE_MINUTES, leaveApprovalEnabled, leaveMinuteMs, testLeaveApprovalPrefix, markLeaveApproval,
  leaveNeedsApproval, fileLeaveRequest, takeLeaveRequest, leaveRequestOf, leaveRequestsOf, dueLeaveRequests,
  mayAnswerLeave,
} from '../backend/leaveRequests.js';

const MIN = 60_000;
const AUTO = LEAVE_AUTO_APPROVE_MINUTES * MIN;

describe('switches', () => {
  it('auto-approval is 15 minutes', () => expect(LEAVE_AUTO_APPROVE_MINUTES).toBe(15));

  it('leave approval is off unless switched on with "true"', () => {
    expect(leaveApprovalEnabled({})).toBe(false);
    expect(leaveApprovalEnabled({ LOCUS_LEAVE_APPROVAL_ENABLED: 'yes' })).toBe(false);
    expect(leaveApprovalEnabled({ LOCUS_LEAVE_APPROVAL_ENABLED: 'true' })).toBe(true);
  });

  it('a Group needs approval only with both switches on', () => {
    const plain = {};
    const nearby = {};
    markLeaveApproval(nearby);
    expect(leaveNeedsApproval(plain, true)).toBe(false);
    expect(leaveNeedsApproval(nearby, false)).toBe(false);
    expect(leaveNeedsApproval(nearby, true)).toBe(true);
    expect(leaveNeedsApproval(undefined, true)).toBe(false);
  });

  it('marking keeps the Group\'s other settings', () => {
    const squad = { settings: { sosEnabled: false, pingEnabled: true, mutedPingers: ['x'] } };
    markLeaveApproval(squad);
    expect(squad.settings).toMatchObject({ sosEnabled: false, mutedPingers: ['x'], leaveApproval: true });
  });

  it('the test-only overrides are ignored in production', () => {
    expect(leaveMinuteMs({})).toBe(MIN);
    expect(leaveMinuteMs({ LOCUS_LEAVE_MINUTE_MS: '50' })).toBe(50);
    expect(leaveMinuteMs({ LOCUS_LEAVE_MINUTE_MS: '50', NODE_ENV: 'production' })).toBe(MIN);
    expect(testLeaveApprovalPrefix({})).toBeNull();
    expect(testLeaveApprovalPrefix({ LOCUS_TEST_LEAVE_APPROVAL_PREFIX: 'NB' })).toBe('NB');
    expect(testLeaveApprovalPrefix({ LOCUS_TEST_LEAVE_APPROVAL_PREFIX: 'NB', NODE_ENV: 'production' })).toBeNull();
  });
});

describe('a request', () => {
  it('is due 15 minutes after it was made, and asking again never moves that', () => {
    const squad = {};
    const first = fileLeaveRequest(squad, { uid: 'u', name: 'U' }, 1000, AUTO);
    expect(first.created).toBe(true);
    expect(first.request.deadline).toBe(1000 + AUTO);
    const again = fileLeaveRequest(squad, { uid: 'u', name: 'U' }, 5 * MIN, AUTO);
    expect(again.created).toBe(false);
    expect(again.request.deadline).toBe(1000 + AUTO);
    expect(dueLeaveRequests(squad, 1000 + AUTO - 1)).toEqual([]);
    expect(dueLeaveRequests(squad, 1000 + AUTO)).toEqual(['u']);
  });

  it('is kept per person, listed oldest first, and taken once', () => {
    const squad = {};
    fileLeaveRequest(squad, { uid: 'b' }, 20, AUTO);
    fileLeaveRequest(squad, { uid: 'a' }, 10, AUTO);
    expect(leaveRequestsOf(squad).map((r) => r.uid)).toEqual(['a', 'b']);
    expect(takeLeaveRequest(squad, 'a').uid).toBe('a');
    expect(takeLeaveRequest(squad, 'a')).toBeNull();
    expect(leaveRequestOf(squad, 'a')).toBeNull();
    expect(leaveRequestOf(squad, 'b').uid).toBe('b');
  });
});

describe('who may answer', () => {
  const ask = (over) => mayAnswerLeave({
    answererRole: 'admin', answererUid: 'x', requesterUid: 'u', requesterIsModerator: false, requesterIsCommander: false, approved: true, ...over,
  });

  it('the admin and moderators may approve or refuse a member', () => {
    for (const answererRole of ['admin', 'moderator']) {
      expect(ask({ answererRole })).toEqual({ ok: true });
      expect(ask({ answererRole, approved: false })).toEqual({ ok: true });
    }
  });

  it('a member may not', () => expect(ask({ answererRole: 'member' })).toEqual({ ok: false, reason: 'not-allowed' }));

  it("nobody answers their own", () => expect(ask({ answererUid: 'u' })).toEqual({ ok: false, reason: 'own-request' }));

  it("only the admin answers a moderator's", () => {
    expect(ask({ answererRole: 'moderator', requesterIsModerator: true })).toEqual({ ok: false, reason: 'admin-only' });
    expect(ask({ answererRole: 'admin', requesterIsModerator: true, approved: false })).toEqual({ ok: true });
  });

  it("the Commander's may be approved, never refused", () => {
    expect(ask({ requesterIsCommander: true })).toEqual({ ok: true });
    expect(ask({ requesterIsCommander: true, approved: false })).toEqual({ ok: false, reason: 'cannot-refuse-commander' });
    expect(ask({ answererRole: 'moderator', requesterIsCommander: true, approved: false })).toEqual({ ok: false, reason: 'cannot-refuse-commander' });
  });
});
