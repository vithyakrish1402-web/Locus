// @vitest-environment jsdom
//
// With the app's switch off (as shipped, TIMED_PRIVACY_ENABLED false), Pause and Hidden are exactly
// as in js-1.1.87: no picker, nothing asked of the server, paused at once and until resumed. The GPS
// accuracy goes with every position either way.
// The real App.jsx, a fake socket and a fake LocusBackground plugin (the mocks are
// backgroundPauseSync.test.jsx's own).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { consentFingerprint } from '../src/utils/backgroundConsent.js';

MotionGlobalConfig.skipAnimations = true;

const fakeSocket = vi.hoisted(() => {
  const handlers = new Map();
  return {
    id: 'self-socket',
    connected: true,
    handlers,
    on: (event, fn) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
    },
    off: (event, fn) => {
      if (!fn) handlers.delete(event);
      else handlers.get(event)?.delete(fn);
    },
    emit: vi.fn(),
    timeout: () => ({ emit: vi.fn() }),
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
  };
});

// The plugin, as the shell would have it. `order` records every call, to show what happens first.
const plugin = vi.hoisted(() => {
  const listeners = [];
  const order = [];
  const p = {
    listeners,
    order,
    caps: { version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false },
    lastState: { running: false, state: 'stopped' },
    getCapabilities: vi.fn(async () => p.caps),
    getState: vi.fn(async () => p.lastState),
    requestPermissions: vi.fn(async () => { order.push('permissions'); }),
    start: vi.fn(async () => { order.push('start'); return { started: true, persisted: true }; }),
    // Like the real plugin: a stop is answered with "stopped" and its reason.
    stop: vi.fn(async ({ reason } = {}) => { order.push('stop'); listeners.slice().forEach((fn) => fn({ state: 'stopped', reason })); }),
    pause: vi.fn(async () => { order.push('pause'); }),
    resume: vi.fn(async () => { order.push('resume'); }),
    acknowledgeStop: vi.fn(async () => {}),
    addListener: vi.fn(async (_event, fn) => {
      listeners.push(fn);
      return { remove: () => { listeners.splice(listeners.indexOf(fn), 1); } };
    }),
  };
  return p;
});
const shell = vi.hoisted(() => ({ hasPlugin: true }));

// The app's switch, off here on purpose: this file is about the app with the feature switched off.
vi.mock('../src/utils/timedPrivacy.js', async (importOriginal) => ({ ...(await importOriginal()), TIMED_PRIVACY_ENABLED: false }));
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({
  auth: { currentUser: { getIdToken: async () => 'id-token-123' } },
  googleProvider: {},
  db: {},
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback({ uid: 'u-self', displayName: 'Alpha', photoURL: null });
    return () => {};
  },
  signInWithPopup: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: (name) => name === 'LocusBackground' && shell.hasPlugin },
  registerPlugin: (name) => (name === 'LocusBackground' ? plugin : {}),
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: () => Promise.resolve({ remove: () => {} }), minimizeApp: vi.fn() },
}));
vi.mock('google-map-react', () => ({ default: () => null }));
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({ default: () => null }));
vi.mock('../src/hooks/useLiveUpdate.js', () => ({
  useLiveUpdate: () => ({ status: 'idle', supported: false, restart: vi.fn() }),
}));
vi.mock('../src/hooks/useAppUpdate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAppUpdate: () => ({
      supported: false,
      status: actual.UpdateStatus.IDLE,
      manifest: null,
      installedVersion: null,
      progress: { percent: -1, loaded: 0, total: 0 },
      error: null,
      mandatory: false,
      dismissed: false,
      check: vi.fn(),
      startDownload: vi.fn(),
      openInstallSettings: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});


const { default: App } = await import('../src/App.jsx');
const { forgetLastStopForTests } = await import('../src/utils/backgroundSharing.js');
const { rememberLocationAllowed } = await import('../src/utils/locationPermission.js');
const { __resetNotifications } = await import('../src/utils/notify.js');

const MIN = 60_000;
const HERE = { lat: 12.8230, lng: 80.0440 };
const SWITCH_KEY = 'locus.backgroundSharing:u-self';
const CONSENT_KEY = 'locus.backgroundSharingConsent:u-self';
let code;
let watchCallback;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, p]) => p);
const answer = (reply) => act(async () => {
  fakeSocket.emit.mock.calls.filter(([e]) => e === 'set-sharing-mode').at(-1)[2](reply);
});
const say = (event) => act(() => plugin.listeners.forEach((fn) => fn(event)));

// Background sharing on, in a Group, on the Members panel.
const sharingInAGroup = async () => {
  localStorage.setItem(CONSENT_KEY, consentFingerprint());
  localStorage.setItem(SWITCH_KEY, '1');
  render(<App />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  await waitFor(() => expect(emitted('request-join').length).toBeGreaterThan(0)); // after its sign-in token
  code = emitted('request-join').at(-1).roomCode;
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await flush();
  await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
  say({ state: 'running' });
  await flush();
  fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
  await flush();
};

beforeEach(() => {
  forgetLastStopForTests();
  localStorage.clear();
  rememberLocationAllowed();
  __resetNotifications();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  for (const fn of [plugin.getCapabilities, plugin.getState, plugin.requestPermissions, plugin.start, plugin.stop, plugin.pause, plugin.resume, plugin.acknowledgeStop, plugin.addListener]) fn.mockClear();
  plugin.listeners.length = 0;
  plugin.order.length = 0;
  plugin.caps = { version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false };
  plugin.lastState = { running: false, state: 'stopped' };
  shell.hasPlugin = true;
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/api/background/status')) return { status: 200, json: async () => ({ available: true }) };
    if (u.endsWith('/api/background/token')) return { status: 200, json: async () => ({ token: 'v1.payload.mac', expiresAt: Date.now() + 14 * 86_400_000, ttlSeconds: 1209600 }) };
    return { status: 404, json: async () => ({}) };
  }));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  watchCallback = null;
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, speed: 0, accuracy: 6 } })),
      watchPosition: vi.fn((cb) => { watchCallback = cb; return 1; }),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete navigator.geolocation;
});

describe('with timed holds off', () => {
  it('pauses at once, until resumed, asking the server nothing', async () => {
    await sharingInAGroup();
    fakeSocket.emit.mockClear();
    plugin.pause.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: 'Paused' }));
    await flush();
    expect(screen.queryByTestId('duration-picker')).toBeNull();
    expect(emitted('set-sharing-mode')).toEqual([]);
    expect(emitted('update-location').at(-1)).toMatchObject({ status: 'FROZEN' });
    expect(plugin.pause).toHaveBeenCalledWith({ minutes: 0 });
    expect(screen.queryByTestId('hold-countdown')).toBeNull();
    expect(screen.queryByTestId('sharing-allowance')).toBeNull();
  });

  it("the notification's Pause asks the server nothing", async () => {
    await sharingInAGroup();
    fakeSocket.emit.mockClear();
    say({ state: 'paused' });
    await flush();
    expect(emitted('set-sharing-mode')).toEqual([]);
    expect(screen.getByRole('radio', { name: 'Paused' }).getAttribute('aria-checked')).toBe('true');
  });

  it('ignores a hold sent by a server that has them on', async () => {
    await sharingInAGroup();
    await act(async () => fakeSocket.receive('sharing-hold', { roomCode: code, mode: 'GHOST', until: Date.now() + 5 * MIN, allowanceLeftMs: 0, serverNow: Date.now() }));
    expect(screen.getByRole('radio', { name: 'Live' }).getAttribute('aria-checked')).toBe('true');
  });

  it('sends the GPS accuracy with every position', async () => {
    await sharingInAGroup();
    fakeSocket.emit.mockClear();
    await act(async () => { await watchCallback({ coords: { latitude: HERE.lat + 0.0001, longitude: HERE.lng, speed: 0, accuracy: 11 } }); });
    expect(emitted('update-location').at(-1)).toMatchObject({ accuracy: 11 });
  });
});
