// @vitest-environment jsdom
//
// Every build except LOCUS Test: background sharing is not there. Same fake shell as
// backgroundSharingApp.test.jsx (an Android app WITH the plugin), but the build mode is not
// 'sidetest', so the switch is absent and the plugin is never asked or started.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

const plugin = vi.hoisted(() => ({
  getCapabilities: vi.fn(async () => ({ version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false })),
  getState: vi.fn(async () => ({ running: false, state: 'stopped', reason: 'group-gone' })),
  requestPermissions: vi.fn(async () => ({})),
  start: vi.fn(async () => ({ started: true })),
  stop: vi.fn(async () => {}),
  acknowledgeStop: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: () => {} })),
}));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: { getIdToken: async () => 'id-token' } }, googleProvider: {}, db: {} }));
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
      supported: false, status: actual.UpdateStatus.IDLE, manifest: null, installedVersion: null,
      progress: { percent: -1, loaded: 0, total: 0 }, error: null, mandatory: false, dismissed: false,
      check: vi.fn(), startDownload: vi.fn(), openInstallSettings: vi.fn(), dismiss: vi.fn(),
    }),
  };
});

// No MODE stub: vitest's own mode ('test') is "any build but LOCUS Test".
const { default: App } = await import('../src/App.jsx');

const HERE = { lat: 12.8230, lng: 80.0440 };
let fetchMock;

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  for (const fn of Object.values(plugin)) fn.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  try { localStorage.setItem('locus.backgroundSharingTest', '1'); } catch { /* no storage */ }
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
  try { localStorage.removeItem('locus.backgroundSharingTest'); } catch { /* no storage */ }
  delete navigator.geolocation;
});

describe('a build that is not LOCUS Test', () => {
  it('has no switch, never asks the plugin, mints no token, even with the old switch value left on', async () => {
    render(<App />);
    const code = document.querySelector('.sr-only').textContent;
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await waitFor(() => screen.getByTestId('settings'));

    expect(screen.queryByTestId('background-sharing-test')).toBeNull();
    expect(screen.queryByText(/Background sharing/)).toBeNull();
    for (const name of ['getCapabilities', 'getState', 'start', 'requestPermissions', 'addListener', 'acknowledgeStop']) {
      expect(plugin[name], name).not.toHaveBeenCalled();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows no "Group ended" message at launch', async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText(/Your Group ended/)).toBeNull();
    expect(plugin.getState).not.toHaveBeenCalled();
  });
});
