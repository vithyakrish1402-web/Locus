import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Capacitor shell, as the code under test sees it. Each test sets what the "phone" is.
const shell = vi.hoisted(() => ({ native: true, platform: 'android', plugins: new Set(['LocusBackground']) }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => shell.native,
    getPlatform: () => shell.platform,
    isPluginAvailable: (name) => shell.plugins.has(name),
  },
  registerPlugin: () => ({}),
}));

const {
  SUPPORTED_PLUGIN_VERSION, checkSupport, isTestSwitchAvailable, mintDeviceToken, pollingMsFor,
  startBackgroundSharing, stopBackgroundSharing,
} = await import('../src/utils/backgroundSharing.js');

const goodCaps = { version: SUPPORTED_PLUGIN_VERSION, running: false, notificationsEnabled: true, locationGranted: true, resumable: false };
const fakePlugin = (overrides = {}) => ({
  getCapabilities: vi.fn(async () => goodCaps),
  requestPermissions: vi.fn(async () => ({})),
  start: vi.fn(async () => ({ started: true, persisted: true })),
  stop: vi.fn(async () => {}),
  ...overrides,
});
const reply = (status, body) => ({ status, json: async () => body });
const okToken = () => ({ token: 'v1.abc.def', expiresAt: Date.now() + 14 * 86_400_000, ttlSeconds: 1209600 });
const OPTIONS = { baseUrl: 'https://server.example', roomCode: 'ABC123', groupName: 'ABC123', pollingMs: 5000, getIdToken: async () => 'id-token' };

beforeEach(() => {
  shell.native = true;
  shell.platform = 'android';
  shell.plugins = new Set(['LocusBackground']);
});
afterEach(() => vi.unstubAllEnvs());

describe('isTestSwitchAvailable', () => {
  it('is only true in the LOCUS Test build', () => {
    vi.stubEnv('MODE', 'sidetest');
    expect(isTestSwitchAvailable()).toBe(true);
    for (const mode of ['production', 'development', 'device-check', 'test']) {
      vi.stubEnv('MODE', mode);
      expect(isTestSwitchAvailable()).toBe(false);
    }
  });
});

describe('pollingMsFor', () => {
  it('uses the same numbers as the Settings refresh rate', () => {
    expect(pollingMsFor('eco')).toBe(15000);
    expect(pollingMsFor('standard')).toBe(5000);
    expect(pollingMsFor('max')).toBe(1000);
    expect(pollingMsFor(undefined)).toBe(5000);
  });
});

describe('checkSupport (the runtime guard)', () => {
  it('is supported in the Android app with the plugin at the version this code speaks', async () => {
    const r = await checkSupport(fakePlugin());
    expect(r).toMatchObject({ supported: true, capabilities: { version: SUPPORTED_PLUGIN_VERSION } });
  });

  it('is not supported in a browser or on another platform', async () => {
    const plugin = fakePlugin();
    shell.native = false;
    expect(await checkSupport(plugin)).toEqual({ supported: false, reason: 'not-android' });
    shell.native = true;
    shell.platform = 'ios';
    expect(await checkSupport(plugin)).toEqual({ supported: false, reason: 'not-android' });
    expect(plugin.getCapabilities).not.toHaveBeenCalled();
  });

  it('is not supported by a shell without the plugin, and never calls it', async () => {
    shell.plugins = new Set();
    const plugin = fakePlugin();
    expect(await checkSupport(plugin)).toEqual({ supported: false, reason: 'no-plugin' });
    expect(plugin.getCapabilities).not.toHaveBeenCalled();
  });

  it('is not supported when the plugin object has no such method', async () => {
    expect(await checkSupport({})).toEqual({ supported: false, reason: 'no-plugin' });
  });

  it('is not supported when the plugin speaks another version, older or newer', async () => {
    for (const version of [0, SUPPORTED_PLUGIN_VERSION + 1, undefined, '1']) {
      const plugin = fakePlugin({ getCapabilities: vi.fn(async () => ({ ...goodCaps, version })) });
      expect(await checkSupport(plugin)).toMatchObject({ supported: false, reason: 'plugin-version' });
    }
  });

  it('is not supported when the plugin throws', async () => {
    const plugin = fakePlugin({ getCapabilities: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await checkSupport(plugin)).toEqual({ supported: false, reason: 'plugin-error' });
  });
});

describe('mintDeviceToken', () => {
  it('asks the server with the person\'s ID token and returns the device token', async () => {
    const fetchImpl = vi.fn(async () => reply(200, okToken()));
    const r = await mintDeviceToken({ baseUrl: 'https://server.example', roomCode: 'ABC123', idToken: 'id-token', fetchImpl });
    expect(r).toMatchObject({ ok: true, token: 'v1.abc.def' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://server.example/api/background/token');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer id-token');
    expect(JSON.parse(init.body)).toEqual({ roomCode: 'ABC123' });
  });

  it('maps what the server says to a reason', async () => {
    const cases = [
      [503, { error: 'disabled' }, 'server-off'],
      [503, { error: 'identity-unavailable' }, 'server-error'],
      [404, { error: 'no-group' }, 'no-group'],
      [403, { error: 'blocked' }, 'blocked'],
      [403, { error: 'not-member' }, 'not-member'],
      [401, { error: 'invalid-token' }, 'not-signed-in'],
      [429, { error: 'rate-limited' }, 'busy'],
      [500, {}, 'server-error'],
    ];
    for (const [status, body, reason] of cases) {
      const r = await mintDeviceToken({ baseUrl: 'https://s', roomCode: 'R', idToken: 't', fetchImpl: async () => reply(status, body) });
      expect(r, `${status}`).toEqual({ ok: false, reason });
    }
  });

  it('is a network failure when the request throws', async () => {
    const r = await mintDeviceToken({ baseUrl: 'https://s', roomCode: 'R', idToken: 't', fetchImpl: async () => { throw new TypeError('offline'); } });
    expect(r).toEqual({ ok: false, reason: 'network' });
  });

  it('does not trust a 200 without a usable token', async () => {
    for (const body of [{}, { token: '', expiresAt: Date.now() + 1000 }, { token: 'x', expiresAt: 'soon' }, { token: 'x', expiresAt: Date.now() - 1 }]) {
      const r = await mintDeviceToken({ baseUrl: 'https://s', roomCode: 'R', idToken: 't', fetchImpl: async () => reply(200, body) });
      expect(r).toEqual({ ok: false, reason: 'server-error' });
    }
  });

  it('copes with an answer that is not JSON', async () => {
    const r = await mintDeviceToken({ baseUrl: 'https://s', roomCode: 'R', idToken: 't', fetchImpl: async () => ({ status: 502, json: async () => { throw new Error('html'); } }) });
    expect(r).toEqual({ ok: false, reason: 'server-error' });
  });
});

describe('startBackgroundSharing', () => {
  it('mints a token and hands it, and nothing else secret, to the plugin', async () => {
    const plugin = fakePlugin();
    const fetchImpl = vi.fn(async () => reply(200, okToken()));
    const r = await startBackgroundSharing({ ...OPTIONS, plugin, fetchImpl });
    expect(r).toEqual({ ok: true });
    expect(plugin.start).toHaveBeenCalledTimes(1);
    const args = plugin.start.mock.calls[0][0];
    expect(args).toMatchObject({ baseUrl: 'https://server.example', roomCode: 'ABC123', groupName: 'ABC123', deviceToken: 'v1.abc.def', pollingMs: 5000 });
    expect(JSON.stringify(args)).not.toContain('id-token'); // the ID token never goes to the plugin
    expect(plugin.requestPermissions).not.toHaveBeenCalled(); // already granted
  });

  it('asks for the two permissions first when either is missing, and goes on once granted', async () => {
    let asked = false;
    const plugin = fakePlugin({
      getCapabilities: vi.fn(async () => (asked ? goodCaps : { ...goodCaps, notificationsEnabled: false })),
      requestPermissions: vi.fn(async () => { asked = true; }),
    });
    const fetchImpl = vi.fn(async () => reply(200, okToken()));
    expect(await startBackgroundSharing({ ...OPTIONS, plugin, fetchImpl })).toEqual({ ok: true });
    expect(plugin.requestPermissions).toHaveBeenCalledWith({ permissions: ['location', 'notifications'] });
    expect(plugin.start).toHaveBeenCalled();
  });

  it('stops, with no token minted, when a permission is refused', async () => {
    const plugin = fakePlugin({
      getCapabilities: vi.fn(async () => ({ ...goodCaps, notificationsEnabled: false })),
    });
    const fetchImpl = vi.fn(async () => reply(200, okToken()));
    expect(await startBackgroundSharing({ ...OPTIONS, plugin, fetchImpl })).toEqual({ ok: false, reason: 'notifications-denied' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(plugin.start).not.toHaveBeenCalled();

    const noLocation = fakePlugin({ getCapabilities: vi.fn(async () => ({ ...goodCaps, locationGranted: false })) });
    expect(await startBackgroundSharing({ ...OPTIONS, plugin: noLocation, fetchImpl })).toEqual({ ok: false, reason: 'location-denied' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does nothing when unsupported', async () => {
    shell.plugins = new Set();
    const plugin = fakePlugin();
    const fetchImpl = vi.fn();
    expect(await startBackgroundSharing({ ...OPTIONS, plugin, fetchImpl })).toEqual({ ok: false, reason: 'unsupported' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a server that refuses, without calling the plugin', async () => {
    const plugin = fakePlugin();
    const r = await startBackgroundSharing({ ...OPTIONS, plugin, fetchImpl: async () => reply(503, { error: 'disabled' }) });
    expect(r).toEqual({ ok: false, reason: 'server-off' });
    expect(plugin.start).not.toHaveBeenCalled();
  });

  it('reports not signed in when there is no ID token', async () => {
    const plugin = fakePlugin();
    const fetchImpl = vi.fn();
    expect(await startBackgroundSharing({ ...OPTIONS, plugin, fetchImpl, getIdToken: async () => { throw new Error('signed out'); } })).toEqual({ ok: false, reason: 'not-signed-in' });
    expect(await startBackgroundSharing({ ...OPTIONS, plugin, fetchImpl, getIdToken: async () => '' })).toEqual({ ok: false, reason: 'not-signed-in' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes on why the plugin refused to start', async () => {
    const plugin = fakePlugin({ start: vi.fn(async () => ({ started: false, state: 'notifications-denied' })) });
    expect(await startBackgroundSharing({ ...OPTIONS, plugin, fetchImpl: async () => reply(200, okToken()) })).toEqual({ ok: false, reason: 'notifications-denied' });
    const throwing = fakePlugin({ start: vi.fn(async () => { throw new Error('bad-arguments'); }) });
    expect(await startBackgroundSharing({ ...OPTIONS, plugin: throwing, fetchImpl: async () => reply(200, okToken()) })).toEqual({ ok: false, reason: 'cannot-start' });
  });
});

describe('stopBackgroundSharing', () => {
  it('tells the plugin to stop, with the reason', async () => {
    const plugin = fakePlugin();
    await stopBackgroundSharing('user-stop', plugin);
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'user-stop' });
  });

  it('never throws, whatever the plugin does', async () => {
    await expect(stopBackgroundSharing('x', fakePlugin({ stop: vi.fn(async () => { throw new Error('boom'); }) }))).resolves.toBeUndefined();
    await expect(stopBackgroundSharing('x', fakePlugin({ stop: vi.fn(() => { throw new Error('sync boom'); }) }))).resolves.toBeUndefined();
    await expect(stopBackgroundSharing('x', {})).resolves.toBeUndefined();
  });

  it('does nothing outside the Android app', async () => {
    shell.native = false;
    const plugin = fakePlugin();
    await stopBackgroundSharing('user-stop', plugin);
    expect(plugin.stop).not.toHaveBeenCalled();
  });
});
