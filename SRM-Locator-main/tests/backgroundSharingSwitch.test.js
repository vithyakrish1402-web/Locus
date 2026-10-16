// @vitest-environment jsdom
//
// Background sharing never moves silently from one Group to another (src/utils/backgroundSharing.js):
// a start for a new Group ends the old Group's sharing first, and a start straight after a stop waits
// for that stop to finish on the phone.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true },
  registerPlugin: () => ({}),
}));

const {
  SUPPORTED_PLUGIN_VERSION, SHARED_ROOM_KEY, STOP_SETTLE_MS, APP_STOP,
  startBackgroundSharing, stopBackgroundSharing, sharedRoom, forgetLastStopForTests,
} = await import('../src/utils/backgroundSharing.js');

const caps = { version: SUPPORTED_PLUGIN_VERSION, running: true, notificationsEnabled: true, locationGranted: true, resumable: true };
const fakePlugin = () => {
  const order = [];
  return {
    order,
    getCapabilities: vi.fn(async () => caps),
    requestPermissions: vi.fn(async () => ({})),
    start: vi.fn(async ({ roomCode }) => { order.push(`start ${roomCode}`); return { started: true, persisted: true }; }),
    stop: vi.fn(async ({ reason }) => { order.push(`stop ${reason}`); }),
  };
};
const token = () => ({ status: 200, json: async () => ({ token: 'v1.abc.def', expiresAt: Date.now() + 86_400_000 }) });
const start = (plugin, roomCode, extra = {}) => startBackgroundSharing({
  baseUrl: 'https://server.example', roomCode, groupName: roomCode, pollingMs: 5000,
  getIdToken: async () => 'id', plugin, fetchImpl: vi.fn(async () => token()), ...extra,
});

beforeEach(() => {
  forgetLastStopForTests();
  localStorage.removeItem(SHARED_ROOM_KEY);
});

describe('moving to another Group', () => {
  it('ends sharing for the old Group before starting for the new one', async () => {
    const plugin = fakePlugin();
    await start(plugin, 'AAA111');
    expect(sharedRoom()).toBe('AAA111');
    const sleep = vi.fn(async () => {});
    await start(plugin, 'BBB222', { sleep });
    expect(plugin.order).toEqual(['start AAA111', `stop ${APP_STOP}`, 'start BBB222']);
    expect(sharedRoom()).toBe('BBB222');
  });

  it('starting again for the same Group stops nothing (a pause carries on)', async () => {
    const plugin = fakePlugin();
    await start(plugin, 'AAA111');
    await start(plugin, 'AAA111');
    expect(plugin.stop).not.toHaveBeenCalled();
  });

  it('remembers the Group only when the service really started', async () => {
    const plugin = fakePlugin();
    plugin.start.mockImplementation(async () => ({ started: false, state: 'location-denied' }));
    await start(plugin, 'AAA111');
    expect(sharedRoom()).toBeNull();
  });

  it('a stop forgets the Group', async () => {
    const plugin = fakePlugin();
    await start(plugin, 'AAA111');
    await stopBackgroundSharing(APP_STOP, plugin);
    expect(sharedRoom()).toBeNull();
  });
});

describe('a start straight after a stop', () => {
  it('waits out the rest of STOP_SETTLE_MS before starting', async () => {
    const plugin = fakePlugin();
    await stopBackgroundSharing(APP_STOP, plugin);
    const stoppedAt = Date.now();
    const sleep = vi.fn(async () => {});
    await start(plugin, 'AAA111', { sleep, now: () => stoppedAt + 1000 });
    expect(sleep).toHaveBeenCalledTimes(1);
    const waited = sleep.mock.calls[0][0];
    expect(waited).toBeGreaterThan(STOP_SETTLE_MS - 1000 - 50);
    expect(waited).toBeLessThanOrEqual(STOP_SETTLE_MS - 1000 + 50);
    expect(plugin.start).toHaveBeenCalledTimes(1);
  });

  it('does not wait when the stop is long finished, or there was none', async () => {
    const plugin = fakePlugin();
    const sleep = vi.fn(async () => {});
    await start(plugin, 'AAA111', { sleep });
    await stopBackgroundSharing(APP_STOP, plugin);
    await start(plugin, 'AAA111', { sleep, now: () => Date.now() + STOP_SETTLE_MS + 1 });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('a start that is no longer wanted by the time it would start', () => {
  it('starts nothing (the person left, or switched it off, while it waited)', async () => {
    const plugin = fakePlugin();
    const result = await start(plugin, 'AAA111', { stillWanted: () => false });
    expect(result).toEqual({ ok: false, reason: 'no-longer-wanted' });
    expect(plugin.start).not.toHaveBeenCalled();
    expect(sharedRoom()).toBeNull();
  });
});
