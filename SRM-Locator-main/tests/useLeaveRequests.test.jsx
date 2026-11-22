// @vitest-environment jsdom
//
// The request-to-leave hook (src/hooks/useLeaveRequests.js) against a fake socket, on a fake clock
// with the server a minute ahead of the phone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useLeaveRequests } from '../src/hooks/useLeaveRequests.js';
import { subscribe, __resetNotifications } from '../src/utils/notify.js';
import { LEAVE_REQUEST, LEAVE_REQUESTS } from '../src/copy/group.js';
import { leaveNeedsRequest, mayReject, sortLeaveRequests, LEAVE_APPROVAL_ENABLED } from '../src/utils/leaveRequests.js';

const MIN = 60_000;
const SKEW = MIN;
const ROOM = 'NB1';
const GATED = { roomCode: ROOM, leaveApproval: true };

const makeSocket = () => {
  const handlers = new Map();
  return {
    handlers,
    on: (event, fn) => { handlers.set(event, fn); },
    off: (event) => { handlers.delete(event); },
    emit: vi.fn(),
    receive: (event, payload) => handlers.get(event)?.(payload),
    answer(event, reply) {
      const call = this.emit.mock.calls.filter(([e]) => e === event).at(-1);
      call[2](reply);
    },
  };
};

let socket;
let notices;
let unsubscribe;
const serverNow = () => Date.now() + SKEW;
const texts = () => notices.map((n) => n.message);

const setup = (props = {}) => {
  const onApproved = vi.fn();
  const view = renderHook((p) => useLeaveRequests({
    socket, roomCode: ROOM, inGroup: true, settings: GATED, canAnswer: false, myUid: 'u-me', onApproved, enabled: true, ...p,
  }), { initialProps: props });
  return { ...view, onApproved };
};
const call = (fn) => {
  let result;
  act(() => { fn().then((r) => { result = r; }); });
  return () => result;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 22, 13, 0, 0));
  socket = makeSocket();
  __resetNotifications();
  notices = [];
  unsubscribe = subscribe((items) => { notices = items; });
});
afterEach(() => {
  cleanup();
  unsubscribe();
  __resetNotifications();
  vi.useRealTimers();
});

describe('the rules', () => {
  it('the switch is on in this release (a Group needs the server to say so too)', () => expect(LEAVE_APPROVAL_ENABLED).toBe(true));

  it('a Leave is a request only with the switch on and the Group saying so', () => {
    expect(leaveNeedsRequest(true, GATED, ROOM)).toBe(true);
    expect(leaveNeedsRequest(false, GATED, ROOM)).toBe(false);
    expect(leaveNeedsRequest(true, { roomCode: ROOM }, ROOM)).toBe(false);
    expect(leaveNeedsRequest(true, { roomCode: 'OTHER', leaveApproval: true }, ROOM)).toBe(false);
    expect(leaveNeedsRequest(true, null, ROOM)).toBe(false);
  });

  it("the Commander's own request can never be rejected", () => {
    expect(mayReject({ fromCommander: true })).toBe(false);
    expect(mayReject({ fromModerator: true })).toBe(true);
    expect(mayReject({})).toBe(true);
  });

  it('lists one request per person, oldest first', () => {
    expect(sortLeaveRequests([{ uid: 'b', requestedAt: 2 }, { uid: 'a', requestedAt: 1 }, { uid: 'b', requestedAt: 3 }]).map((r) => r.uid)).toEqual(['a', 'b']);
  });
});

describe("a member's own request", () => {
  it('is sent, and waits with a deadline counted by the server\'s clock', async () => {
    const { result } = setup();
    expect(result.current.needsRequest).toBe(true);
    const answer = call(() => result.current.request());
    expect(socket.emit).toHaveBeenCalledWith('request-leave', { roomCode: ROOM }, expect.any(Function));
    const deadline = serverNow() + 15 * MIN;
    await act(async () => socket.answer('request-leave', { ok: true, requestedAt: serverNow(), deadline, serverNow: serverNow() }));
    expect(answer()).toMatchObject({ ok: true });
    expect(result.current.mine).toEqual({ requestedAt: expect.any(Number), deadline });
    expect(result.current.offset).toBe(SKEW);
    expect(texts()).toContain(LEAVE_REQUEST.sent);
  });

  it('is not needed (and not sent) where the Group does not need one', async () => {
    const { result } = setup({ settings: { roomCode: ROOM } });
    expect(result.current.needsRequest).toBe(false);
    const answer = call(() => result.current.request());
    await act(async () => {});
    expect(answer()).toEqual({ ok: false, reason: 'not-required' });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("is handed back by the server on reopening, with the same deadline and the server's clock", () => {
    const { result } = setup();
    const deadline = serverNow() + 9 * MIN;
    act(() => socket.receive('leave-request-pending', { roomCode: ROOM, requestedAt: serverNow() - 6 * MIN, deadline, serverNow: serverNow() }));
    expect(result.current.mine.deadline).toBe(deadline);
    expect(result.current.offset).toBe(SKEW);
  });

  it('can be cancelled', async () => {
    const { result } = setup();
    act(() => socket.receive('leave-request-pending', { roomCode: ROOM, requestedAt: serverNow(), deadline: serverNow() + 15 * MIN, serverNow: serverNow() }));
    call(() => result.current.cancel());
    expect(socket.emit).toHaveBeenLastCalledWith('cancel-leave', { roomCode: ROOM }, expect.any(Function));
    await act(async () => socket.answer('cancel-leave', { ok: true }));
    act(() => socket.receive('leave-request-cancelled', { roomCode: ROOM, reason: 'cancelled' }));
    expect(result.current.mine).toBeNull();
    expect(texts()).toContain(LEAVE_REQUEST.cancelled);
  });

  it('approved: the app is told, with the right words for a person and for the clock', () => {
    const { result, onApproved } = setup();
    act(() => socket.receive('leave-request-pending', { roomCode: ROOM, deadline: serverNow() + MIN, serverNow: serverNow() }));
    act(() => socket.receive('leave-approved', { roomCode: ROOM, auto: false }));
    expect(onApproved).toHaveBeenCalledWith(false);
    expect(texts()).toContain(LEAVE_REQUEST.approved);
    act(() => socket.receive('leave-approved', { roomCode: ROOM, auto: true }));
    expect(onApproved).toHaveBeenLastCalledWith(true);
    expect(texts()).toContain(LEAVE_REQUEST.approvedAuto);
    expect(result.current.mine).toBeNull();
  });

  it('rejected: they stay, and are told by whom', () => {
    const { result, onApproved } = setup();
    act(() => socket.receive('leave-request-pending', { roomCode: ROOM, deadline: serverNow() + MIN, serverNow: serverNow() }));
    act(() => socket.receive('leave-rejected', { roomCode: ROOM, byName: 'Asha' }));
    expect(result.current.mine).toBeNull();
    expect(onApproved).not.toHaveBeenCalled();
    expect(texts()).toContain('Asha turned down your request to leave. You stay in the group.');
  });

  it('gone, or cancelled because they now lead the Group: said plainly', () => {
    const { result } = setup();
    act(() => socket.receive('leave-request-pending', { roomCode: ROOM, deadline: serverNow() + MIN, serverNow: serverNow() }));
    act(() => socket.receive('leave-request-withdrawn', { roomCode: ROOM, uid: 'u-me', reason: 'gone' }));
    expect(result.current.mine).toBeNull();
    expect(texts()).toContain(LEAVE_REQUEST.gone);
    act(() => socket.receive('leave-request-pending', { roomCode: ROOM, deadline: serverNow() + MIN, serverNow: serverNow() }));
    act(() => socket.receive('leave-request-cancelled', { roomCode: ROOM, reason: 'took-command' }));
    expect(texts()).toContain(LEAVE_REQUEST.tookCommand);
  });

  it("someone else's request closing says nothing to this person", () => {
    setup();
    act(() => socket.receive('leave-request-pending', { roomCode: ROOM, deadline: serverNow() + MIN, serverNow: serverNow() }));
    act(() => socket.receive('leave-request-withdrawn', { roomCode: ROOM, uid: 'u-other', reason: 'gone' }));
    expect(texts()).not.toContain(LEAVE_REQUEST.gone);
  });

  it('with no answer: says the server could not be reached', async () => {
    const { result } = setup();
    const answer = call(() => result.current.request());
    await act(async () => { vi.advanceTimersByTime(8000); });
    expect(answer()).toEqual({ ok: false, reason: 'timeout' });
    expect(texts()).toContain(LEAVE_REQUEST.unreachable);
    expect(result.current.mine).toBeNull();
  });

  it("with the app's switch off: nothing is listened to", () => {
    const { result } = setup({ enabled: false });
    expect(result.current.needsRequest).toBe(false);
    expect(socket.handlers.size).toBe(0);
  });
});

describe('the Group Lead and moderators', () => {
  const request = (uid, extra = {}) => ({ roomCode: ROOM, uid, name: uid.toUpperCase(), requestedAt: serverNow(), deadline: serverNow() + 15 * MIN, fromModerator: false, fromCommander: false, serverNow: serverNow(), ...extra });

  it('get the list on opening, and each new request with a notice, once', () => {
    const { result } = setup({ canAnswer: true });
    expect(socket.emit).toHaveBeenCalledWith('get-leave-requests', { roomCode: ROOM }, expect.any(Function));
    act(() => socket.answer('get-leave-requests', { ok: true, requests: [request('ann')], serverNow: serverNow() }));
    expect(result.current.requests.map((r) => r.uid)).toEqual(['ann']);
    act(() => socket.receive('leave-request', request('bo')));
    act(() => socket.receive('leave-request', request('bo'))); // re-sent on a change of command
    expect(result.current.requests.map((r) => r.uid)).toEqual(['ann', 'bo']);
    expect(notices.filter((n) => n.message === LEAVE_REQUESTS.newNotice('BO'))).toHaveLength(1);
  });

  it('a request re-sent later (a change of command) is not announced again', async () => {
    setup({ canAnswer: true });
    act(() => socket.receive('leave-request', request('cy')));
    await act(async () => { vi.advanceTimersByTime(10_000); }); // the first notice has gone
    expect(texts()).not.toContain(LEAVE_REQUESTS.newNotice('CY'));
    act(() => socket.receive('leave-request', request('cy')));
    expect(texts()).not.toContain(LEAVE_REQUESTS.newNotice('CY'));
  });

  it('answer with resolve-leave, and the request leaves the list', async () => {
    const { result } = setup({ canAnswer: true });
    act(() => socket.receive('leave-request', request('ann')));
    call(() => result.current.answer('ann', true));
    expect(socket.emit).toHaveBeenLastCalledWith('resolve-leave', { roomCode: ROOM, uid: 'ann', approved: true }, expect.any(Function));
    await act(async () => socket.answer('resolve-leave', { ok: true }));
    expect(result.current.requests).toEqual([]);
  });

  it("are told plainly when the server refuses an answer", async () => {
    const { result } = setup({ canAnswer: true });
    act(() => socket.receive('leave-request', request('cmdr', { fromCommander: true })));
    call(() => result.current.answer('cmdr', false));
    await act(async () => socket.answer('resolve-leave', { ok: false, reason: 'cannot-refuse-commander' }));
    expect(texts()).toContain(LEAVE_REQUESTS.refused['cannot-refuse-commander']);
    expect(result.current.requests.map((r) => r.uid)).toEqual(['cmdr']);
  });

  it('a request that has gone leaves the list', () => {
    const { result } = setup({ canAnswer: true });
    act(() => socket.receive('leave-request', request('ann')));
    act(() => socket.receive('leave-request-withdrawn', { roomCode: ROOM, uid: 'ann', reason: 'cancelled' }));
    expect(result.current.requests).toEqual([]);
  });

  it('a member gets no list and no notices', () => {
    const { result } = setup({ canAnswer: false });
    expect(socket.emit).not.toHaveBeenCalledWith('get-leave-requests', expect.anything(), expect.anything());
    act(() => socket.receive('leave-request', request('ann')));
    expect(result.current.requests).toEqual([]);
    expect(texts()).toEqual([]);
  });
});
