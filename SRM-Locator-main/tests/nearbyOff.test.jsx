// @vitest-environment jsdom
//
// Nearby Join in the real App.jsx with the app's switch off (as shipped).
// Only the socket, Firebase, native plugins, maps and the update hooks are stubbed.
/* eslint-disable no-unused-vars -- the harness is nearbyApp.test.jsx's; some of its helpers are not needed here */
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
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
    timeout: () => ({ emit: vi.fn() }),
  };
});

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback({ uid: 'u-self', displayName: 'Alpha', photoURL: null });
    return () => {};
  },
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
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
const { NEARBY } = await import('../src/copy/group.js');
const { __resetNotifications } = await import('../src/utils/notify.js');
const { rememberLocationAllowed } = await import('../src/utils/locationPermission.js');

const A = { lat: 12.8230, lng: 80.0440 };
const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, payload]) => payload);
const answer = (event, reply) => act(async () => {
  fakeSocket.emit.mock.calls.filter(([e]) => e === event).at(-1)[2](reply);
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
let watchers; // every watchPosition success callback, in order
let currents; // every getCurrentPosition success callback, in order

// The server says whether it has Nearby on (a scan from no group): 'not-in-squad' is on. The check is
// answered, then forgotten, so each test sees only what it does itself.
const renderLobby = async ({ serverNearby = 'not-in-squad' } = {}) => {
  render(<App />);
  await flush();
  if (emitted('nearby-scan').length) await answer('nearby-scan', { ok: false, reason: serverNearby });
  fakeSocket.emit.mockClear();
};
const toggle = () => screen.queryByRole('switch', { name: new RegExp(NEARBY.toggle) });
// Signed in -> lobby -> Create group, let in as `role`, then the Members panel.
const inGroup = async ({ role = 'OWNER', moderator = false } = {}) => {
  await renderLobby();
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  const roomCode = emitted('request-join').at(-1).roomCode;
  act(() => fakeSocket.receive('access-granted', { role, roomCode }));
  if (moderator) act(() => fakeSocket.receive('group-role', { roomCode, role: 'moderator', moderatorIds: [], ownAdmin: false }));
  await flush();
  fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
  return roomCode;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
  localStorage.clear();
  sessionStorage.clear();
  rememberLocationAllowed();
  __resetNotifications();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  watchers = [];
  currents = [];
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok) => { currents.push(ok); }),
      watchPosition: vi.fn((ok) => { watchers.push(ok); return watchers.length; }),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('with the switch off (as shipped)', () => {
  it('the lobby has no opt-in and no Nearby start, and nothing is sent', async () => {
    await renderLobby();
    expect(toggle()).toBeNull();
    expect(screen.queryByRole('button', { name: NEARBY.startButton })).toBeNull();
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
    expect(emitted('nearby-discoverable')).toEqual([]);
  });

  it('the Group Lead has no Nearby button, and an invite sent anyway shows nothing', async () => {
    await inGroup({ role: 'OWNER' });
    expect(screen.queryByTestId('nearby-button')).toBeNull();
    act(() => fakeSocket.receive('nearby-invite', { inviteId: 'inv1', fromName: 'Asha', expiresAt: Date.now() + 60_000, serverNow: Date.now() }));
    expect(screen.queryByTestId('nearby-invite')).toBeNull();
    expect(emitted('nearby-scan')).toEqual([]);
  });
});
