// @vitest-environment jsdom
//
// Opening LOCUS again (after a swipe, or from the sharing notification) when this phone was in a
// Group: it is offered back ("Return to <Group>" / "Start fresh"), never silently replaced by a
// new Group, and never joined without asking. Real App.jsx, fake socket, fake LocusBackground plugin.
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
const SWITCH_KEY = 'locus.backgroundSharing';
const CONSENT_KEY = 'locus.backgroundSharingConsent';
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

const { LOBBY, RESUME, NOT_APPROVED, WAITING } = await import('../src/copy/access.js');
const GROUP_KEY = 'locus.group';
const OLD = 'OLDGRP';
const remember = (groupCode = OLD, role = 'OWNER', uid = 'u-self') => localStorage.setItem(GROUP_KEY, JSON.stringify({ v: 2, code: groupCode, role, uid }));
const joins = () => fakeSocket.emit.mock.calls.filter(([e]) => e === 'request-join').map(([, p]) => p);
const stored = () => JSON.parse(localStorage.getItem(GROUP_KEY) ?? 'null');
const sharingOn = () => { localStorage.setItem(CONSENT_KEY, consentFingerprint()); localStorage.setItem(SWITCH_KEY, '1'); };
const resumeScreen = () => screen.queryByTestId('resume');
// The app opened by someone this phone remembers: no lobby code to read, unlike renderApp.
const openApp = async () => {
  render(<App />);
  await flush();
};
const returnTo = async () => {
  fireEvent.click(screen.getByRole('button', { name: RESUME.returnButton(OLD) }));
  await flush();
};

describe('remembering the Group', () => {
  it('is remembered once the server lets the person in, with the role it gave', async () => {
    await renderApp();
    await intoGroup();
    expect(stored()).toEqual({ v: 2, code, role: 'OWNER', uid: 'u-self' });
  });

  it('is not remembered while still waiting for approval', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('radio', { name: LOBBY.joinTab }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'WAITME' } });
    fireEvent.click(screen.getByRole('button', { name: LOBBY.joinButton }));
    act(() => fakeSocket.receive('access-pending', { roomCode: 'WAITME' }));
    await flush();
    expect(stored()).toBeNull();
  });

  it('is forgotten on leaving the Group', async () => {
    await renderApp();
    await intoGroup();
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByTestId('leave-group'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Leave the group?' })).getByRole('button', { name: 'Leave group' }));
    await flush();
    expect(stored()).toBeNull();
  });

  it('is forgotten on being removed from the Group', async () => {
    await renderApp();
    await intoGroup();
    act(() => fakeSocket.receive('exiled', { reason: 'blocked' }));
    await flush();
    expect(stored()).toBeNull();
  });

  it('is forgotten on signing out', async () => {
    await renderApp();
    await intoGroup();
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await flush();
    expect(stored()).toBeNull();
  });

  it('is forgotten when a reconnect finds the Group gone', async () => {
    await renderApp();
    await intoGroup();
    act(() => fakeSocket.receive('squad-not-found', { roomCode: code }));
    await flush();
    expect(stored()).toBeNull();
  });
});

describe('opening the app again with a remembered Group', () => {
  it('offers it back and joins nothing until asked: no create, no join', async () => {
    remember();
    await openApp();
    expect(resumeScreen()).toBeTruthy();
    expect(within(resumeScreen()).getByText(RESUME.body(OLD, 'OWNER'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: LOBBY.createButton })).toBeNull();
    expect(joins()).toEqual([]);
  });

  it('is not offered when an older version remembered it (it may be a Group left long ago)', async () => {
    localStorage.setItem(GROUP_KEY, JSON.stringify({ code: OLD, role: 'OWNER', uid: 'u-self' }));
    await openApp();
    expect(resumeScreen()).toBeNull();
    expect(screen.getByRole('button', { name: LOBBY.createButton })).toBeTruthy();
    expect(joins()).toEqual([]);
  });

  it('is not offered to another account on the same phone', async () => {
    remember(OLD, 'OWNER', 'someone-else');
    await openApp();
    expect(resumeScreen()).toBeNull();
    expect(screen.getByRole('button', { name: LOBBY.createButton })).toBeTruthy();
  });

  it('Return asks to JOIN that Group (never create, never resume), and the Group Lead is back in', async () => {
    remember(OLD, 'OWNER');
    await openApp();
    await returnTo();
    expect(joins()).toEqual([expect.objectContaining({ roomCode: OLD, intent: 'join', user: expect.objectContaining({ uid: 'u-self' }) })]);
    expect(screen.getByTestId('returning')).toBeTruthy();
    expect(screen.queryByTestId('waiting')).toBeNull();
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: OLD }));
    await flush();
    expect(screen.queryByTestId('returning')).toBeNull();
    // Back, not newly approved: no "You're in" welcome.
    expect(screen.queryByTestId('youre-in')).toBeNull();
    expect(stored()).toEqual({ v: 2, code: OLD, role: 'OWNER', uid: 'u-self' });
  });

  it('a member is back in as a member, with no approval step on this phone', async () => {
    remember(OLD, 'MEMBER');
    await openApp();
    expect(within(resumeScreen()).getByText(RESUME.body(OLD, 'MEMBER'))).toBeTruthy();
    await returnTo();
    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: OLD }));
    await flush();
    expect(screen.queryByTestId('returning')).toBeNull();
    expect(screen.queryByTestId('waiting')).toBeNull();
  });

  it('a Group that has ended: the lobby says so, sharing for it stops, nothing is created', async () => {
    remember();
    sharingOn();
    await openApp();
    await returnTo();
    plugin.stop.mockClear();
    act(() => fakeSocket.receive('squad-not-found', { roomCode: OLD }));
    await flush();
    expect(screen.getByText(LOBBY.ended(OLD))).toBeTruthy();
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'app-stop' });
    expect(stored()).toBeNull();
    expect(joins().filter((j) => j.intent !== 'join')).toEqual([]);
  });

  it('a person who was blocked is refused, the Group is forgotten and sharing for it stops', async () => {
    remember();
    sharingOn();
    await openApp();
    await returnTo();
    plugin.stop.mockClear();
    act(() => fakeSocket.receive('access-denied', { roomCode: OLD }));
    await flush();
    expect(screen.getByText(NOT_APPROVED.title)).toBeTruthy();
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'app-stop' });
    expect(stored()).toBeNull();
  });

  it('a person who had left is a stranger again: they wait for approval', async () => {
    remember(OLD, 'MEMBER');
    await openApp();
    await returnTo();
    act(() => fakeSocket.receive('access-pending', { roomCode: OLD }));
    await flush();
    expect(screen.getByText(WAITING.title)).toBeTruthy();
    expect(screen.queryByTestId('returning')).toBeNull();
  });

  it('Start fresh: the lobby, sharing for the old Group stopped, the Group forgotten, nothing joined', async () => {
    remember();
    sharingOn();
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: RESUME.freshButton }));
    await flush();
    expect(resumeScreen()).toBeNull();
    expect(screen.getByRole('button', { name: LOBBY.createButton })).toBeTruthy();
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'app-stop' });
    expect(stored()).toBeNull();
    expect(joins()).toEqual([]);
  });

  it('Start fresh while returning: the request is withdrawn and the lobby shows', async () => {
    remember();
    await openApp();
    await returnTo();
    fireEvent.click(within(screen.getByTestId('returning')).getByRole('button', { name: RESUME.freshButton }));
    await flush();
    expect(fakeSocket.emit.mock.calls.some(([e]) => e === 'cancel-join')).toBe(true);
    expect(screen.getByRole('button', { name: LOBBY.createButton })).toBeTruthy();
    expect(stored()).toBeNull();
  });

  it('when sharing ended because the Group was gone, the lobby says so instead of offering it', async () => {
    remember();
    plugin.lastState = { running: false, state: 'stopped', reason: 'group-gone' };
    await openApp();
    await flush();
    expect(resumeScreen()).toBeNull();
    expect(screen.getByText(LOBBY.groupEndedRestart)).toBeTruthy();
    expect(stored()).toBeNull();
  });
});
