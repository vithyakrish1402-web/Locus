// @vitest-environment jsdom
//
// Pause behaves the same wherever it is pressed: on the sharing notification or in the app, with
// the app open, in the background or opened again. The service, the app's own connection and its
// screen always agree, so the Group sees Paused. Real App.jsx, fake socket, fake LocusBackground plugin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { BACKGROUND_SHARING } from '../src/copy/settings.js';
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
// A stop makes the next start wait a few seconds (STOP_SETTLE_MS); each test starts without one.
const { forgetLastStopForTests } = await import('../src/utils/backgroundSharing.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
// The switch and consent are the signed-in account's own (u-self here): src/utils/backgroundConsent.js.
const SWITCH_KEY = 'locus.backgroundSharing:u-self';
const CONSENT_KEY = 'locus.backgroundSharingConsent:u-self';
const COPY = BACKGROUND_SHARING;
let code;
let server;
let fetchMock;

const goodToken = () => ({ token: 'v1.payload.mac', expiresAt: Date.now() + 14 * 86_400_000, ttlSeconds: 1209600 });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const renderApp = async () => {
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  await flush();
};
const intoGroup = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await flush();
};
const openSettings = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
  await waitFor(() => screen.getByTestId('settings'));
};
const section = () => screen.getByTestId('background-sharing');
const theSwitch = () => within(section()).getByRole('switch');
const stateText = () => screen.getByTestId('background-sharing-state').textContent;
const consentSheet = () => screen.queryByTestId('background-sharing-consent');
const tokenRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/background/token'));

beforeEach(() => {
  forgetLastStopForTests();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  for (const fn of [plugin.getCapabilities, plugin.getState, plugin.requestPermissions, plugin.start, plugin.stop, plugin.pause, plugin.resume, plugin.acknowledgeStop, plugin.addListener]) fn.mockClear();
  plugin.requestPermissions.mockImplementation(async () => { plugin.order.push('permissions'); });
  plugin.listeners.length = 0;
  plugin.order.length = 0;
  plugin.caps = { version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false };
  plugin.lastState = { running: false, state: 'stopped' };
  shell.hasPlugin = true;
  server = { status: { code: 200, body: { available: true } }, token: { code: 200, body: null } };
  fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/api/background/status')) return { status: server.status.code, json: async () => server.status.body };
    if (u.endsWith('/api/background/token')) {
      plugin.order.push('mint');
      return { status: server.token.code, json: async () => server.token.body ?? goodToken() };
    }
    return { status: 404, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  try { localStorage.removeItem(SWITCH_KEY); localStorage.removeItem(CONSENT_KEY); } catch { /* no storage */ }
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, speed: 0 } })),
      watchPosition: vi.fn(() => 1),
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

const sharingOn = () => { localStorage.setItem(CONSENT_KEY, consentFingerprint()); localStorage.setItem(SWITCH_KEY, '1'); };
const say = (event) => act(() => plugin.listeners.forEach((fn) => fn(event)));
const locationReports = () => fakeSocket.emit.mock.calls.filter(([e]) => e === 'update-location').map(([, p]) => p.status);
const modeRadio = (name) => screen.getByRole('radio', { name });
const sharingInAGroup = async () => {
  sharingOn();
  await renderApp();
  await intoGroup();
  await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
  await flush();
};

describe('Pause on the notification, with the app open', () => {
  it('the app pauses too: its own connection sends Paused, and the screen says Paused', async () => {
    await sharingInAGroup();
    fakeSocket.emit.mockClear();
    say({ state: 'paused' });
    await flush();
    expect(modeRadio('Paused').getAttribute('aria-checked')).toBe('true');
    expect(locationReports()).toContain('FROZEN');
    expect(locationReports()).not.toContain('ACTIVE');
    // And the pause is not echoed back to the service.
    expect(plugin.pause).not.toHaveBeenCalled();
  });

  it('Resume on the notification (or the pause running out) makes the app Live again', async () => {
    await sharingInAGroup();
    say({ state: 'paused' });
    await flush();
    fakeSocket.emit.mockClear();
    say({ state: 'running' });
    await flush();
    expect(modeRadio('Live').getAttribute('aria-checked')).toBe('true');
    expect(locationReports()).toContain('ACTIVE');
    expect(plugin.resume).not.toHaveBeenCalled();
  });

  it('a Hidden person stays hidden whatever the notification says', async () => {
    await sharingInAGroup();
    fireEvent.click(modeRadio('Hidden'));
    await flush();
    say({ state: 'paused' });
    await flush();
    expect(modeRadio('Hidden').getAttribute('aria-checked')).toBe('true');
  });
});

describe('Paused and Live in the app', () => {
  it('Paused in the app pauses the service until resumed; Live resumes it', async () => {
    await sharingInAGroup();
    fireEvent.click(modeRadio('Paused'));
    await flush();
    expect(plugin.pause).toHaveBeenCalledWith({ minutes: 0 });
    fireEvent.click(modeRadio('Live'));
    await flush();
    expect(plugin.resume).toHaveBeenCalledTimes(1);
  });

  it('sharing that starts while the app is already Paused starts paused', async () => {
    // The service is still starting: its start has not answered yet.
    let started;
    plugin.start.mockImplementationOnce(() => {
      plugin.order.push('start');
      return new Promise((resolve) => { started = () => resolve({ started: true, persisted: true }); });
    });
    sharingOn();
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    await flush();
    // Paused now: on the phone this pause reaches no service yet, and is lost.
    fireEvent.click(modeRadio('Paused'));
    await flush();
    const pausesBefore = plugin.pause.mock.calls.length;
    await act(async () => { started(); });
    say({ state: 'running' });
    await flush();
    // Paused again once it runs.
    expect(plugin.pause.mock.calls.length).toBeGreaterThan(pausesBefore);
    expect(plugin.pause).toHaveBeenLastCalledWith({ minutes: 0 });
    expect(modeRadio('Paused').getAttribute('aria-checked')).toBe('true');
  });

  it('Hidden stops background sharing (it can only show the person); Live starts it again', async () => {
    await sharingInAGroup();
    plugin.stop.mockClear();
    fireEvent.click(modeRadio('Hidden'));
    await flush();
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'app-stop' });
    forgetLastStopForTests(); // the wait after a stop has its own tests (backgroundSharing.test.js)
    fireEvent.click(modeRadio('Live'));
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(2));
  });
});

describe('opened again while the service is paused', () => {
  it('the app starts out Paused, and never sends a live position over the pause', async () => {
    plugin.lastState = { running: true, state: 'paused' };
    plugin.caps = { ...plugin.caps, running: true };
    sharingOn();
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    await flush();
    expect(modeRadio('Paused').getAttribute('aria-checked')).toBe('true');
    expect(locationReports()).not.toContain('ACTIVE');
  });
});

describe('Start fresh after opening again while paused', () => {
  it('the pause taken over from the old Group ends with it: the new Group starts Live', async () => {
    localStorage.setItem('locus.group', JSON.stringify({ v: 2, code: 'OLDGRP', role: 'OWNER', uid: 'u-self' }));
    plugin.lastState = { running: true, state: 'paused' };
    plugin.caps = { ...plugin.caps, running: true };
    sharingOn();
    render(<App />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await flush();
    code = document.querySelector('.sr-only').textContent;
    await intoGroup();
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    await flush();
    expect(modeRadio('Live').getAttribute('aria-checked')).toBe('true');
  });
});

describe('leaving while sharing is still starting', () => {
  it('starts nothing for the Group that was left', async () => {
    let tokenArrives;
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith('/api/background/status')) return { status: 200, json: async () => ({ available: true }) };
      if (u.endsWith('/api/background/token')) {
        await new Promise((resolve) => { tokenArrives = resolve; });
        return { status: 200, json: async () => goodToken() };
      }
      return { status: 404, json: async () => ({}) };
    });
    sharingOn();
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(tokenArrives).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByTestId('leave-group'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Leave the group?' })).getByRole('button', { name: 'Leave group' }));
    await flush();
    forgetLastStopForTests(); // not saved by the wait after the leave's stop: the start must see it is unwanted
    await act(async () => { tokenArrives(); });
    await flush();
    expect(plugin.start).not.toHaveBeenCalled();
  });
});
