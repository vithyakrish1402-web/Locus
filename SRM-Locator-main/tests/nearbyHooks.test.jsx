// @vitest-environment jsdom
//
// Nearby Join's two hooks (Stage 6) against a fake socket, a fake geolocation and a fake clock:
// being discoverable (src/hooks/useDiscoverable.js) and pressing Nearby (src/hooks/useNearbyScan.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useDiscoverable } from '../src/hooks/useDiscoverable.js';
import { useNearbyScan } from '../src/hooks/useNearbyScan.js';
import { subscribe, __resetNotifications } from '../src/utils/notify.js';
import { NEARBY } from '../src/copy/group.js';
import { NEARBY_ENABLED, fixPayload, mergeInviteResults, answerStatus } from '../src/utils/nearby.js';

const makeSocket = () => {
  const handlers = new Map();
  return {
    handlers,
    on: (event, fn) => { handlers.set(event, fn); },
    off: (event) => { handlers.delete(event); },
    emit: vi.fn(),
    receive: (event, payload) => handlers.get(event)?.(payload),
    calls(event) { return this.emit.mock.calls.filter(([e]) => e === event); },
    answer(event, reply) { this.calls(event).at(-1)[2](reply); },
  };
};
const makeGeo = () => {
  const geo = { watcher: null, current: null };
  geo.watchPosition = vi.fn((ok, fail) => { geo.watcher = { ok, fail }; return 7; });
  geo.clearWatch = vi.fn(() => { geo.watcher = null; });
  geo.getCurrentPosition = vi.fn((ok, fail) => { geo.current = { ok, fail }; });
  geo.fix = (lat, lng, accuracy) => geo.watcher?.ok({ coords: { latitude: lat, longitude: lng, accuracy } });
  return geo;
};

let socket;
let geo;
let notices;
let unsubscribe;
const texts = () => notices.map((n) => n.message);
const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 23, 10, 0, 0));
  socket = makeSocket();
  geo = makeGeo();
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

describe('the helpers', () => {
  it('the switch is on in this release (shown only once the server says so)', () => expect(NEARBY_ENABLED).toBe(true));

  it('send a position with its accuracy, and none when the phone gave none', () => {
    expect(fixPayload({ latitude: 1, longitude: 2, accuracy: 6 })).toEqual({ lat: 1, lng: 2, accuracy: 6 });
    expect(fixPayload({ latitude: 1, longitude: 2 })).toEqual({ lat: 1, lng: 2 });
    expect(fixPayload(null)).toBeNull();
  });

  it('match each answer to its row', () => {
    const rows = mergeInviteResults([{ id: 'a', status: 'idle' }, { id: 'b', status: 'idle' }], [{ id: 'a', inviteId: 'i1' }]);
    expect(rows).toEqual([{ id: 'a', status: 'invited', inviteId: 'i1' }, { id: 'b', status: 'idle' }]);
    expect(answerStatus({ accepted: true })).toBe('joined');
    expect(answerStatus({ accepted: false, expired: true })).toBe('expired');
    expect(answerStatus({ accepted: false })).toBe('declined');
  });
});

describe('being discoverable', () => {
  const setup = (props = {}) => {
    const onAccepted = vi.fn();
    const onServerOff = vi.fn();
    const view = renderHook((p) => useDiscoverable({
      socket, geolocation: geo, enabled: true, inLobby: true, user: { uid: 'u1', displayName: 'Uma' },
      getIdToken: async () => 'token-1', onAccepted, onServerOff, ...p,
    }), { initialProps: props });
    return { ...view, onAccepted, onServerOff };
  };
  const turnOn = async (result) => {
    act(() => result.current.setOn(true));
    await flush();
    act(() => geo.fix(12.82, 80.04, 6));
    await flush();
    act(() => socket.answer('nearby-discoverable', { ok: true, discoverable: true }));
  };

  it('asks for location only when turned on, and then announces with position and accuracy', async () => {
    const { result } = setup();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    await turnOn(result);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(socket.calls('nearby-discoverable')[0][1]).toEqual({ on: true, idToken: 'token-1', user: { uid: 'u1', name: 'Uma' }, lat: 12.82, lng: 80.04, accuracy: 6 });
    expect(result.current.on).toBe(true);
  });

  it('sends a fresh position, with accuracy, every 5 s while on, and nothing once off', async () => {
    const { result } = setup();
    await turnOn(result);
    act(() => geo.fix(12.83, 80.05, 9)); // too soon after the announcement
    expect(socket.calls('nearby-position')).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(5000); });
    act(() => geo.fix(12.83, 80.05, 9));
    expect(socket.calls('nearby-position').map(([, p]) => p)).toEqual([{ lat: 12.83, lng: 80.05, accuracy: 9 }]);
    act(() => result.current.setOn(false));
    expect(socket.calls('nearby-discoverable').at(-1)[1]).toEqual({ on: false });
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    socket.emit.mockClear();
    await act(async () => { vi.advanceTimersByTime(6000); });
    act(() => geo.fix(12.84, 80.06, 5));
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('stops at once on joining a group', async () => {
    const { result, rerender } = setup();
    await turnOn(result);
    rerender({ inLobby: false });
    expect(result.current.on).toBe(false);
    expect(geo.clearWatch).toHaveBeenCalled();
  });

  it('stops when the app goes to the background, and says so', async () => {
    const { result } = setup();
    await turnOn(result);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    expect(result.current.on).toBe(false);
    expect(geo.clearWatch).toHaveBeenCalled();
    expect(texts()).toContain(NEARBY.stoppedHidden);
  });

  it('stops when the app closes (unmounts)', async () => {
    const { result, unmount } = setup();
    await turnOn(result);
    unmount();
    expect(geo.clearWatch).toHaveBeenCalled();
  });

  it('location refused: off again, with why in plain words', async () => {
    const { result } = setup();
    act(() => result.current.setOn(true));
    await flush();
    act(() => geo.watcher.fail({ code: 1 }));
    expect(result.current.on).toBe(false);
    expect(texts()).toContain(NEARBY.permissionDenied);
  });

  it("the server's Nearby off: off again, and the app is told", async () => {
    const { result, onServerOff } = setup();
    act(() => result.current.setOn(true));
    await flush();
    act(() => geo.fix(12.82, 80.04, 6));
    await flush();
    act(() => socket.answer('nearby-discoverable', { ok: false, reason: 'disabled' }));
    expect(result.current.on).toBe(false);
    expect(onServerOff).toHaveBeenCalled();
  });

  it("with the app's switch off: nothing at all", () => {
    const { result } = setup({ enabled: false });
    act(() => result.current.setOn(true));
    expect(result.current.on).toBe(false);
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('an invite: shown, with the server clock; Accept answers and the app joins', async () => {
    const { result, onAccepted } = setup();
    await turnOn(result);
    const serverNow = Date.now() + 60_000;
    act(() => socket.receive('nearby-invite', { inviteId: 'inv1', fromName: 'Asha', expiresAt: serverNow + 120_000, serverNow }));
    expect(result.current.invite).toMatchObject({ inviteId: 'inv1', fromName: 'Asha', offset: 60_000 });
    act(() => { result.current.respond(true); });
    expect(socket.calls('nearby-respond')[0][1]).toEqual({ inviteId: 'inv1', accept: true });
    await act(async () => socket.answer('nearby-respond', { ok: true, roomCode: 'NY9' }));
    expect(onAccepted).toHaveBeenCalledWith('NY9');
    expect(result.current.invite).toBeNull();
  });

  it.each([
    ['expired', NEARBY.inviteExpired],
    ['used', NEARBY.inviteUsed],
    ['no-invite', NEARBY.inviteGone],
  ])('an invite answered %s: a short explanation, nothing more', async (reason, words) => {
    const { result, onAccepted } = setup();
    await turnOn(result);
    act(() => socket.receive('nearby-invite', { inviteId: 'inv1', fromName: 'Asha', expiresAt: Date.now() + 1000, serverNow: Date.now() }));
    act(() => { result.current.respond(true); });
    await act(async () => socket.answer('nearby-respond', { ok: false, reason }));
    expect(texts()).toContain(words);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it('an invite that runs out goes, with a word', async () => {
    const { result } = setup();
    await turnOn(result);
    act(() => socket.receive('nearby-invite', { inviteId: 'inv1', fromName: 'Asha', expiresAt: Date.now() + 1000, serverNow: Date.now() }));
    act(() => socket.receive('nearby-invite-expired', { inviteId: 'inv1' }));
    expect(result.current.invite).toBeNull();
    expect(texts()).toContain(NEARBY.inviteExpired);
  });

  it('Decline only closes it', async () => {
    const { result, onAccepted } = setup();
    await turnOn(result);
    act(() => socket.receive('nearby-invite', { inviteId: 'inv1', fromName: 'Asha', expiresAt: Date.now() + 60_000, serverNow: Date.now() }));
    act(() => { result.current.respond(false); });
    expect(socket.calls('nearby-respond')[0][1]).toEqual({ inviteId: 'inv1', accept: false });
    await act(async () => socket.answer('nearby-respond', { ok: true }));
    expect(onAccepted).not.toHaveBeenCalled();
    expect(result.current.invite).toBeNull();
  });
});

describe('pressing Nearby', () => {
  const setup = () => {
    const onServerOff = vi.fn();
    const view = renderHook(() => useNearbyScan({ socket, roomCode: 'G1', geolocation: geo, onServerOff }));
    return { ...view, onServerOff };
  };
  const scanWith = async (result, reply, coords = { latitude: 12.82, longitude: 80.04, accuracy: 7 }) => {
    act(() => { result.current.scan(); });
    act(() => geo.current.ok({ coords }));
    await flush();
    await act(async () => socket.answer('nearby-scan', reply));
  };

  it("sends the presser's position and accuracy, and lists names only", async () => {
    const { result } = setup();
    await scanWith(result, { ok: true, hereUsable: true, people: [{ id: 's1', name: 'Bo' }, { id: 's2', name: 'Cy' }] });
    expect(socket.calls('nearby-scan')[0][1]).toEqual({ roomCode: 'G1', lat: 12.82, lng: 80.04, accuracy: 7 });
    expect(result.current.state).toBe('done');
    expect(result.current.rows.map((r) => r.name)).toEqual(['Bo', 'Cy']);
  });

  it('too rough a position: says so', async () => {
    const { result } = setup();
    await scanWith(result, { ok: true, hereUsable: false, people: [] });
    expect(result.current.state).toBe('rough');
  });

  it('the rate limit: "try again in a moment"', async () => {
    const { result } = setup();
    await scanWith(result, { ok: false, reason: 'too-many', retryAfterSec: 30 });
    expect(result.current.state).toBe('limited');
  });

  it("the server's Nearby off: the app is told", async () => {
    const { result, onServerOff } = setup();
    await scanWith(result, { ok: false, reason: 'disabled' });
    expect(onServerOff).toHaveBeenCalled();
  });

  it('selects, invites the selected, or Add all, and follows each answer', async () => {
    const { result } = setup();
    await scanWith(result, { ok: true, hereUsable: true, people: [{ id: 's1', name: 'Bo' }, { id: 's2', name: 'Cy' }, { id: 's3', name: 'Di' }] });
    act(() => result.current.toggle('s1'));
    expect(result.current.rows[0].selected).toBe(true);
    act(() => { result.current.invite(['s1']); });
    expect(socket.calls('nearby-invite')[0][1]).toEqual({ roomCode: 'G1', ids: ['s1'] });
    await act(async () => socket.answer('nearby-invite', { ok: true, invited: 1, sent: [{ id: 's1', inviteId: 'i1' }] }));
    act(() => { result.current.inviteAll(); });
    expect(socket.calls('nearby-invite')[1][1]).toEqual({ roomCode: 'G1', all: true });
    await act(async () => socket.answer('nearby-invite', { ok: true, invited: 3, sent: [{ id: 's1', inviteId: 'i1' }, { id: 's2', inviteId: 'i2' }, { id: 's3', inviteId: 'i3' }] }));
    expect(result.current.rows.map((r) => r.status)).toEqual(['invited', 'invited', 'invited']);
    act(() => socket.receive('nearby-invite-answered', { roomCode: 'G1', inviteId: 'i1', name: 'Bo', accepted: true }));
    act(() => socket.receive('nearby-invite-answered', { roomCode: 'G1', inviteId: 'i2', name: 'Cy', accepted: false }));
    act(() => socket.receive('nearby-invite-answered', { roomCode: 'G1', inviteId: 'i3', name: 'Di', accepted: false, expired: true }));
    expect(result.current.rows.map((r) => r.status)).toEqual(['joined', 'declined', 'expired']);
    expect(texts()).toEqual(expect.arrayContaining([NEARBY.joinedNotice('Bo'), NEARBY.declinedNotice('Cy'), NEARBY.expiredNotice('Di')]));
  });

  it("an answer for another group's invite changes nothing", async () => {
    const { result } = setup();
    await scanWith(result, { ok: true, hereUsable: true, people: [{ id: 's1', name: 'Bo' }] });
    act(() => socket.receive('nearby-invite-answered', { roomCode: 'OTHER', inviteId: 'i1', name: 'Bo', accepted: true }));
    expect(result.current.rows[0].status).toBe('idle');
    expect(texts()).toEqual([]);
  });
});
