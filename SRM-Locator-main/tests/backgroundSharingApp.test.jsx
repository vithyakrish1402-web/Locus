// @vitest-environment jsdom
//
// Background sharing (Stage 3b Part B), through the real App.jsx with a fake LocusBackground
// plugin and a fake server: the test switch in Settings (LOCUS Test build only), starting when
// in a Group with the switch on, stopping on leaving, and the lobby message when the Group ended
// while the app was closed. The native half has its own tests (android/app/src).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

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

// The plugin, as the shell would have it. `listeners` lets a test make it say things on its own.
const plugin = vi.hoisted(() => {
  const listeners = [];
  const p = {
    listeners,
    caps: { version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false },
    lastState: { running: false, state: 'stopped' },
    getCapabilities: vi.fn(async () => p.caps),
    getState: vi.fn(async () => p.lastState),
    requestPermissions: vi.fn(async () => ({})),
    start: vi.fn(async () => ({ started: true, persisted: true })),
    stop: vi.fn(async () => {}),
    addListener: vi.fn(async (_event, fn) => {
      listeners.push(fn);
      return { remove: () => { listeners.splice(listeners.indexOf(fn), 1); } };
    }),
  };
  return p;
});

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
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: (name) => name === 'LocusBackground' },
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

const HERE = { lat: 12.8230, lng: 80.0440 };
const SWITCH_KEY = 'locus.backgroundSharingTest';
let code;
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
const openSettings = () => fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
const theSwitch = () => within(screen.getByTestId('background-sharing-test')).getByRole('switch');

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  for (const fn of [plugin.getCapabilities, plugin.getState, plugin.requestPermissions, plugin.start, plugin.stop, plugin.addListener]) fn.mockClear();
  plugin.listeners.length = 0;
  plugin.caps = { version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false };
  plugin.lastState = { running: false, state: 'stopped' };
  fetchMock = vi.fn(async () => ({ status: 200, json: async () => goodToken() }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('MODE', 'sidetest');
  try { localStorage.removeItem(SWITCH_KEY); } catch { /* no storage */ }
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
  vi.unstubAllEnvs();
  delete navigator.geolocation;
});

const tokenRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/background/token'));

describe('the test switch', () => {
  it('is in Settings in the LOCUS Test build, off to begin with', async () => {
    await renderApp();
    await intoGroup();
    openSettings();
    await waitFor(() => screen.getByTestId('background-sharing-test'));
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
    expect(plugin.start).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
  });

  it('is not in any other build, and the plugin is never even asked', async () => {
    vi.stubEnv('MODE', 'production');
    await renderApp();
    await intoGroup();
    openSettings();
    await flush();
    expect(screen.queryByTestId('background-sharing-test')).toBeNull();
    expect(plugin.getCapabilities).not.toHaveBeenCalled();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is not shown by a shell whose plugin speaks another version', async () => {
    plugin.caps = { ...plugin.caps, version: 2 };
    await renderApp();
    await intoGroup();
    openSettings();
    await flush();
    expect(screen.queryByTestId('background-sharing-test')).toBeNull();
    expect(plugin.start).not.toHaveBeenCalled();
  });
});

describe('sharing', () => {
  it('starts when the switch is turned on in a Group, with a token minted for that Group', async () => {
    await renderApp();
    await intoGroup();
    openSettings();
    await waitFor(() => screen.getByTestId('background-sharing-test'));
    fireEvent.click(theSwitch());
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));

    const [[url, init]] = tokenRequests();
    expect(url).toBe('https://locus-1-896t.onrender.com/api/background/token');
    expect(init.headers.authorization).toBe('Bearer id-token-123');
    expect(JSON.parse(init.body)).toEqual({ roomCode: code });
    expect(plugin.start.mock.calls[0][0]).toMatchObject({
      baseUrl: 'https://locus-1-896t.onrender.com', roomCode: code, deviceToken: 'v1.payload.mac', pollingMs: 5000,
    });
    await waitFor(() => expect(screen.getByTestId('background-sharing-test').textContent).toContain('On:'));
  });

  it('starts by itself on the next Group when the switch was left on', async () => {
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    expect(plugin.start).not.toHaveBeenCalled(); // not in a Group yet
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
    expect(plugin.start.mock.calls[0][0].roomCode).toBe(code);
  });

  it('does not start while only waiting to be let in', async () => {
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    fireEvent.click(screen.getByRole('radio', { name: 'Join a group' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: 'K7M2QX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
    await flush();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // ... and starts once the Group Lead lets them in.
    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'K7M2QX' }));
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
    expect(plugin.start.mock.calls[0][0].roomCode).toBe('K7M2QX');
  });

  it('stops when the switch is turned off', async () => {
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalled());
    openSettings();
    await waitFor(() => screen.getByTestId('background-sharing-test'));
    fireEvent.click(theSwitch());
    await waitFor(() => expect(plugin.stop).toHaveBeenCalledWith({ reason: 'user-stop' }));
  });

  it('stops when the person leaves the Group', async () => {
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalled());
    plugin.stop.mockClear();

    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByTestId('leave-group'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Leave the group?' })).getByRole('button', { name: 'Leave group' }));
    await flush();
    expect(fakeSocket.emit.mock.calls.some(([e]) => e === 'leave-squad')).toBe(true);
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'user-stop' });
  });

  it('says why when the server has background sharing switched off, and never calls the plugin to start', async () => {
    fetchMock.mockImplementation(async () => ({ status: 503, json: async () => ({ error: 'disabled' }) }));
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    openSettings();
    await waitFor(() => expect(screen.getByTestId('background-sharing-test').textContent).toContain('The server has it switched off.'));
    expect(plugin.start).not.toHaveBeenCalled();
  });

  it('shows when the service stopped by itself', async () => {
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalled());
    openSettings();
    await waitFor(() => screen.getByTestId('background-sharing-test'));
    act(() => plugin.listeners.forEach((fn) => fn({ state: 'stopped', reason: 'forbidden' })));
    await waitFor(() => expect(screen.getByTestId('background-sharing-test').textContent).toContain('Stopped (forbidden)'));
  });
});

describe('opening the app after the Group ended', () => {
  const MESSAGE = 'Your Group ended (the server restarted). Rejoin with the code.';

  it('says so in the lobby when the last sharing stopped because the Group was gone', async () => {
    plugin.lastState = { running: false, state: 'stopped', reason: 'group-gone' };
    await renderApp();
    await waitFor(() => expect(screen.getByText(MESSAGE)).toBeTruthy());
  });

  it('says nothing for any other ending', async () => {
    for (const reason of ['user-stop', 'forbidden', 'token-expired', undefined]) {
      plugin.lastState = { running: false, state: 'stopped', reason };
      await renderApp();
      await flush();
      expect(screen.queryByText(MESSAGE), String(reason)).toBeNull();
      cleanup();
    }
  });

  it('says nothing while sharing is still running', async () => {
    plugin.lastState = { running: true, state: 'running', reason: 'group-gone' };
    await renderApp();
    await flush();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('says nothing in a build without the switch', async () => {
    vi.stubEnv('MODE', 'production');
    plugin.lastState = { running: false, state: 'stopped', reason: 'group-gone' };
    await renderApp();
    await flush();
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(plugin.getState).not.toHaveBeenCalled();
  });
});
