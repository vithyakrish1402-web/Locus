// @vitest-environment jsdom
//
// The timed Pause and Hidden hook (src/hooks/useTimedPrivacy.js) against a fake socket, on a fake
// clock. The server's clock runs a minute ahead of the phone's here, so anything timed by the
// phone's own clock would be a minute out and the tests would see it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useTimedPrivacy } from '../src/hooks/useTimedPrivacy.js';
import { subscribe, __resetNotifications } from '../src/utils/notify.js';
import { TIMED_PRIVACY } from '../src/copy/group.js';
import { clockLabel } from '../src/utils/timedPrivacy.js';

const MIN = 60_000;
const SKEW = MIN; // the server is a minute ahead
const ROOM = 'G1';

const makeSocket = () => {
  const handlers = new Map();
  return {
    handlers,
    on: (event, fn) => { handlers.set(event, fn); },
    off: (event) => { handlers.delete(event); },
    emit: vi.fn(),
    receive: (event, payload) => handlers.get(event)?.(payload),
    // The ack of the latest emit of `event`.
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
const grant = (mode, minutes, allowanceLeftMs) => ({ ok: true, mode, until: serverNow() + minutes * MIN, allowanceLeftMs, serverNow: serverNow() });
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const texts = () => notices.map((n) => n.message);

const setup = (props = {}) => {
  const applyMode = vi.fn();
  const view = renderHook((p) => useTimedPrivacy({ socket, roomCode: ROOM, inGroup: true, applyMode, enabled: true, ...p }), { initialProps: props });
  return { ...view, applyMode };
};
const ask = async (result, mode, minutes) => {
  let answer;
  act(() => { result.current.request(mode, minutes).then((a) => { answer = a; }); });
  return () => answer;
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

describe('asking for a hold', () => {
  it('sends set-sharing-mode and, once granted, follows the server: hold, minutes, what is left', async () => {
    const { result, applyMode } = setup();
    const answer = await ask(result, 'FROZEN', 10);
    expect(socket.emit).toHaveBeenCalledWith('set-sharing-mode', { roomCode: ROOM, mode: 'FROZEN', minutes: 10 }, expect.any(Function));
    expect(applyMode).not.toHaveBeenCalled(); // nothing until the server agrees
    await act(async () => socket.answer('set-sharing-mode', grant('FROZEN', 10, 20 * MIN)));
    expect(answer()).toMatchObject({ ok: true });
    expect(result.current.hold).toMatchObject({ mode: 'FROZEN' });
    expect(result.current.allowanceLeftMs).toBe(20 * MIN);
    expect(result.current.offset).toBe(SKEW);
    expect(applyMode).toHaveBeenCalledWith('FROZEN', { minutes: 10 });
  });

  it('refused for the allowance: says how much is left, in plain words, and changes nothing', async () => {
    const { result, applyMode } = setup();
    await ask(result, 'GHOST', 30);
    await act(async () => socket.answer('set-sharing-mode', { ok: false, reason: 'allowance', allowanceLeftMs: 7 * MIN + 30_000 }));
    expect(texts()).toContain('Only 7 min of Pause and Hidden is left this hour. Pick that or less.');
    expect(result.current.hold).toBeNull();
    expect(applyMode).not.toHaveBeenCalled();
  });

  it('refused with nothing left: says the hour is used up', async () => {
    const { result } = setup();
    await ask(result, 'GHOST', 5);
    await act(async () => socket.answer('set-sharing-mode', { ok: false, reason: 'allowance', allowanceLeftMs: 0 }));
    expect(texts()).toContain(TIMED_PRIVACY.refused(0));
  });

  it("with the server's switch off: inactive, and the caller does what js-1.1.87 did", async () => {
    const { result } = setup();
    const answer = await ask(result, 'FROZEN', 5);
    await act(async () => socket.answer('set-sharing-mode', { ok: false, reason: 'disabled' }));
    expect(answer()).toEqual({ ok: false, reason: 'disabled' });
    expect(result.current.active).toBe(false);
  });

  it('with no answer: says the server could not be reached', async () => {
    const { result } = setup();
    const answer = await ask(result, 'FROZEN', 5);
    await advance(8000);
    expect(answer()).toEqual({ ok: false, reason: 'timeout' });
    expect(texts()).toContain(TIMED_PRIVACY.unreachable);
  });

  it("with the app's switch off: nothing is sent and nothing is listened to", async () => {
    const { result } = setup({ enabled: false });
    const answer = await ask(result, 'FROZEN', 5);
    await act(async () => {});
    expect(answer()).toEqual({ ok: false, reason: 'off' });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.handlers.has('sharing-hold')).toBe(false);
    expect(result.current.active).toBe(false);
  });
});

describe('the heads-up before the end', () => {
  const held = async (mode, minutes, allowanceLeftMs) => {
    const view = setup();
    await ask(view.result, mode, minutes);
    await act(async () => socket.answer('set-sharing-mode', grant(mode, minutes, allowanceLeftMs)));
    return view;
  };

  it("comes 2 minutes before the end by the server's clock, saying when, in the phone's clock", async () => {
    const { result } = await held('GHOST', 10, 15 * MIN);
    const end = clockLabel(result.current.hold.until, SKEW);
    await advance(8 * MIN - 1000);
    expect(texts()).not.toContain(TIMED_PRIVACY.headsUp(end));
    await advance(1000);
    expect(texts()).toContain(TIMED_PRIVACY.headsUp(end));
  });

  it('carries "Hide again" while time is left, which asks for the same mode and what is left', async () => {
    const { result } = await held('GHOST', 10, 15 * MIN);
    await advance(8 * MIN);
    const headsUp = notices.find((n) => n.message.startsWith("You'll be visible again"));
    expect(headsUp.action.label).toBe('Hide again');
    socket.emit.mockClear();
    act(() => { headsUp.action.onClick(); });
    // 15 minutes left of the hour, plus the 2 of this hold not used yet, at most 30.
    expect(socket.emit).toHaveBeenCalledWith('set-sharing-mode', { roomCode: ROOM, mode: 'GHOST', minutes: 17 }, expect.any(Function));
    expect(result.current.pending).toBe(true);
  });

  it('carries "Pause again" for a Pause', async () => {
    await held('FROZEN', 10, 15 * MIN);
    await advance(8 * MIN);
    expect(notices.find((n) => n.message.startsWith("You'll be visible again")).action.label).toBe('Pause again');
  });

  it('carries no button when nothing is left', async () => {
    await held('GHOST', 10, 0);
    await advance(8 * MIN);
    const headsUp = notices.find((n) => n.message.startsWith("You'll be visible again"));
    expect(headsUp).toBeDefined();
    expect(headsUp.action).toBeUndefined();
  });

  it('comes at once for a hold shorter than 2 minutes, and only once', async () => {
    await held('FROZEN', 1, 10 * MIN);
    await advance(0);
    expect(notices.filter((n) => n.message.startsWith("You'll be visible again"))).toHaveLength(1);
    await advance(30_000);
    expect(notices.filter((n) => n.message.startsWith("You'll be visible again"))).toHaveLength(1);
  });

  it('a refused "Hide again" says how much is left', async () => {
    await held('GHOST', 10, 15 * MIN);
    await advance(8 * MIN);
    act(() => { notices.find((n) => n.message.startsWith("You'll be visible again")).action.onClick(); });
    await act(async () => socket.answer('set-sharing-mode', { ok: false, reason: 'allowance', allowanceLeftMs: 3 * MIN }));
    expect(texts()).toContain('Only 3 min of Pause and Hidden is left this hour. Pick that or less.');
  });
});

describe('opened again mid-hold', () => {
  it('takes the hold back up from what the server sends, countdown and heads-up included', async () => {
    const { result, applyMode } = setup();
    const until = serverNow() + 9 * MIN;
    act(() => socket.receive('sharing-hold', { roomCode: ROOM, mode: 'GHOST', until, allowanceLeftMs: 4 * MIN, serverNow: serverNow() }));
    expect(result.current.hold).toEqual({ mode: 'GHOST', until });
    expect(applyMode).toHaveBeenCalledWith('GHOST', { minutes: 9 });
    await advance(7 * MIN);
    expect(texts()).toContain(TIMED_PRIVACY.headsUp(clockLabel(until, SKEW)));
  });

  it('late in a hold, shows the heads-up at once', async () => {
    setup();
    const until = serverNow() + 90_000;
    act(() => socket.receive('sharing-hold', { roomCode: ROOM, mode: 'FROZEN', until, allowanceLeftMs: 4 * MIN, serverNow: serverNow() }));
    await advance(0);
    expect(texts()).toContain(TIMED_PRIVACY.headsUp(clockLabel(until, SKEW)));
  });

  it('is not shown again when a reconnect brings the same hold back', async () => {
    setup();
    const until = serverNow() + 90_000;
    const same = () => socket.receive('sharing-hold', { roomCode: ROOM, mode: 'GHOST', until, allowanceLeftMs: 4 * MIN, serverNow: serverNow() });
    act(same);
    await advance(0);
    act(same); // the server sends it on every return to the Group
    await advance(1000);
    expect(notices.filter((n) => n.message.startsWith("You'll be visible again"))).toHaveLength(1);
  });

  it('ignores a hold for another Group', () => {
    const { result } = setup();
    act(() => socket.receive('sharing-hold', { roomCode: 'OTHER', mode: 'FROZEN', until: serverNow() + MIN, serverNow: serverNow() }));
    expect(result.current.hold).toBeNull();
  });
});

describe('the end of a hold', () => {
  const held = async () => {
    const view = setup();
    await ask(view.result, 'GHOST', 10);
    await act(async () => socket.answer('set-sharing-mode', grant('GHOST', 10, 15 * MIN)));
    view.applyMode.mockClear();
    return view;
  };

  it.each([
    ['expired', "You're visible to your group again."],
    ['resumed', "You're visible to your group again."],
    ['sos', "You're visible to your group again: sharing resumed because you sent an SOS."],
  ])('ended by the server (%s): Live again, and told so', async (reason, words) => {
    const { result, applyMode } = await held();
    act(() => socket.receive('sharing-hold-ended', { reason, endedMode: 'GHOST', mode: 'ACTIVE', until: null, allowanceLeftMs: 5 * MIN, serverNow: serverNow() }));
    expect(result.current.hold).toBeNull();
    expect(applyMode).toHaveBeenCalledWith('ACTIVE');
    expect(texts()).toContain(words);
  });

  it('an SOS sent here ends it at once, without waiting for the server, and says so once', async () => {
    const { result, applyMode } = await held();
    act(() => result.current.onSosSent());
    expect(result.current.hold).toBeNull();
    expect(applyMode).toHaveBeenCalledWith('ACTIVE');
    act(() => socket.receive('sharing-hold-ended', { reason: 'sos', mode: 'ACTIVE', until: null, serverNow: serverNow() }));
    expect(notices.filter((n) => n.message === TIMED_PRIVACY.ended.sos)).toHaveLength(1);
  });

  it('never outlives its end time here, even with no word from the server', async () => {
    const { result, applyMode } = await held();
    await advance(10 * MIN + 5000);
    expect(result.current.hold).toBeNull();
    expect(applyMode).toHaveBeenCalledWith('ACTIVE');
    expect(texts()).toContain(TIMED_PRIVACY.ended.expired);
  });

  it('going Live ends it with the server, and says so', async () => {
    const { result, applyMode } = await held();
    await ask(result, 'ACTIVE');
    expect(socket.emit).toHaveBeenLastCalledWith('set-sharing-mode', { roomCode: ROOM, mode: 'ACTIVE' }, expect.any(Function));
    await act(async () => socket.answer('set-sharing-mode', { ok: true, mode: 'ACTIVE', until: null, allowanceLeftMs: 14 * MIN, serverNow: serverNow() }));
    expect(result.current.hold).toBeNull();
    expect(applyMode).toHaveBeenCalledWith('ACTIVE');
    expect(texts()).toContain(TIMED_PRIVACY.ended.resumed);
  });
});
