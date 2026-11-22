// @vitest-environment jsdom
//
// Request to leave in the real App.jsx with the app's switch off (as shipped): Leave as in js-1.1.87.
// Only the socket, Firebase, native plugins, maps and the update hooks are stubbed.
/* eslint-disable no-unused-vars -- the harness is leaveRequestsApp.test.jsx's; some of its helpers are not needed here */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
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

// The app's switch, off here on purpose: this file is about the app with the feature switched off.
vi.mock('../src/utils/leaveRequests.js', async (importOriginal) => ({ ...(await importOriginal()), LEAVE_APPROVAL_ENABLED: false }));
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
const { LEAVE_REQUEST, LEAVE_REQUESTS } = await import('../src/copy/group.js');
const { clockLabel } = await import('../src/utils/timedPrivacy.js');
const { __resetNotifications } = await import('../src/utils/notify.js');
const { rememberLocationAllowed } = await import('../src/utils/locationPermission.js');

const MIN = 60_000;
const SKEW = MIN; // the server is a minute ahead of the phone
const A = { lat: 12.8230, lng: 80.0440 };
const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, payload]) => payload);
const answer = (event, reply) => act(async () => {
  fakeSocket.emit.mock.calls.filter(([e]) => e === event).at(-1)[2](reply);
});
const serverNow = () => Date.now() + SKEW;
let roomCode;

// Signed in -> lobby -> Create group, let in as `role`, the Group's settings saying whether its
// Leave is a request, then the Members panel.
const inGroup = async ({ role = 'MEMBER', gated = true } = {}) => {
  navigator.geolocation.getCurrentPosition.mockImplementation((ok) => ok({ coords: { latitude: A.lat, longitude: A.lng, speed: 0, accuracy: 6 } }));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  roomCode = emitted('request-join').at(-1).roomCode;
  act(() => fakeSocket.receive('access-granted', { role, roomCode }));
  await act(async () => {});
  act(() => fakeSocket.receive('group-settings', { roomCode, sosEnabled: true, pingEnabled: true, sosCooldownMs: 0, sosCooldownPresetsMs: [0], pingMuted: false, ...(gated ? { leaveApproval: true } : {}) }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
};
const leaveButton = () => screen.getByTestId('leave-group');
// The Leave sheet's own button (a request's sheet, or the old Leave's).
const confirmIn = async (name) => {
  fireEvent.click(leaveButton());
  const sheet = await screen.findByTestId(name === LEAVE_REQUEST.confirm ? 'leave-request-confirm' : 'leave-group-confirm');
  fireEvent.click(within(sheet).getByRole('button', { name }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
  localStorage.clear();
  sessionStorage.clear();
  rememberLocationAllowed();
  __resetNotifications();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('with the switch off (as shipped)', () => {
  it('Leave is as in js-1.1.87, even in a Group that needs a request', async () => {
    await inGroup();
    expect(leaveButton().textContent).toBe('Leave group');
    await confirmIn('Leave group');
    expect(emitted('request-leave')).toEqual([]);
    expect(emitted('leave-squad').length).toBeGreaterThan(0);
  });

  it('nothing is asked or listened for', async () => {
    await inGroup({ role: 'OWNER' });
    expect(emitted('get-leave-requests')).toEqual([]);
    act(() => fakeSocket.receive('leave-request', { roomCode, uid: 'Ann', name: 'Ann', deadline: Date.now() + MIN }));
    expect(screen.queryByText(LEAVE_REQUESTS.newNotice('Ann'))).toBeNull();
  });
});
