// @vitest-environment jsdom
//
// Nearby Join in the real App.jsx (Stage 6), with the app's switch on.
// Only the socket, Firebase, native plugins, maps and the update hooks are stubbed.
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


vi.mock('../src/utils/nearby.js', async (importOriginal) => ({ ...(await importOriginal()), NEARBY_ENABLED: true }));

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

const renderLobby = async () => {
  render(<App />);
  await flush();
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

describe('being discoverable, in the lobby', () => {
  it('asks for location only when turned on, sends position and accuracy, shows it, and stops on Turn off', async () => {
    await renderLobby();
    expect(toggle()).toBeTruthy();
    expect(navigator.geolocation.watchPosition).not.toHaveBeenCalled();
    expect(emitted('nearby-discoverable')).toEqual([]);
    fireEvent.click(toggle());
    await flush();
    expect(navigator.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    await act(async () => watchers[0]({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 6 } }));
    await flush();
    expect(emitted('nearby-discoverable').at(-1)).toMatchObject({ on: true, lat: A.lat, lng: A.lng, accuracy: 6, user: { uid: 'u-self' } });
    await answer('nearby-discoverable', { ok: true, discoverable: true });
    expect(screen.getByTestId('discoverable-indicator').textContent).toContain(NEARBY.visible);
    fireEvent.click(screen.getByRole('button', { name: NEARBY.turnOff }));
    expect(emitted('nearby-discoverable').at(-1)).toEqual({ on: false });
    expect(navigator.geolocation.clearWatch).toHaveBeenCalled();
    expect(screen.queryByTestId('discoverable-indicator')).toBeNull();
  });

  it('stops at once on joining a group', async () => {
    await renderLobby();
    fireEvent.click(toggle());
    await flush();
    await act(async () => watchers[0]({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 6 } }));
    await flush();
    await answer('nearby-discoverable', { ok: true, discoverable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    await flush();
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(1);
  });

  it("with the server's Nearby off, the opt-in goes away", async () => {
    await renderLobby();
    fireEvent.click(toggle());
    await flush();
    await act(async () => watchers[0]({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 6 } }));
    await flush();
    await answer('nearby-discoverable', { ok: false, reason: 'disabled' });
    expect(toggle()).toBeNull();
    expect(screen.getByText(NEARBY.unavailable)).toBeTruthy();
  });

  it('an accepted invite joins that group the usual way', async () => {
    await renderLobby();
    fireEvent.click(toggle());
    await flush();
    await act(async () => watchers[0]({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 6 } }));
    await flush();
    await answer('nearby-discoverable', { ok: true, discoverable: true });
    act(() => fakeSocket.receive('nearby-invite', { inviteId: 'inv1', fromName: 'Asha', expiresAt: Date.now() + 120_000, serverNow: Date.now() }));
    expect(await screen.findByText(NEARBY.inviteTitle('Asha'))).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1000); });
    fireEvent.click(screen.getByRole('button', { name: NEARBY.accept }));
    expect(emitted('nearby-respond')).toEqual([{ inviteId: 'inv1', accept: true }]);
    await answer('nearby-respond', { ok: true, roomCode: 'NYASHA' });
    await waitFor(() => expect(emitted('request-join').at(-1)).toMatchObject({ roomCode: 'NYASHA', intent: 'join' }));
  });
});

describe('pressing Nearby', () => {
  it('from the lobby: checks Nearby is on, starts a group the usual way marked as Nearby, then scans', async () => {
    await renderLobby();
    fireEvent.click(screen.getByRole('button', { name: NEARBY.startButton }));
    expect(emitted('nearby-scan')).toEqual([{ roomCode: null }]);
    expect(emitted('request-join')).toEqual([]);
    await answer('nearby-scan', { ok: false, reason: 'not-in-squad' });
    await waitFor(() => expect(emitted('request-join').length).toBe(1));
    const join = emitted('request-join')[0];
    expect(join).toMatchObject({ intent: 'create', nearby: true });
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: join.roomCode }));
    await flush();
    await waitFor(() => expect(currents.length).toBeGreaterThan(0));
    await act(async () => currents.at(-1)({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 8 } }));
    await flush();
    expect(emitted('nearby-scan').at(-1)).toEqual({ roomCode: join.roomCode, lat: A.lat, lng: A.lng, accuracy: 8 });
    await answer('nearby-scan', { ok: true, hereUsable: true, people: [{ id: 's1', name: 'Bo' }] });
    expect(screen.getByRole('checkbox', { name: NEARBY.select('Bo') })).toBeTruthy();
    expect(screen.getByText(NEARBY.eachAccepts)).toBeTruthy();
  });

  it("from the lobby, with the server's Nearby off: no group is made, and Nearby goes away", async () => {
    await renderLobby();
    fireEvent.click(screen.getByRole('button', { name: NEARBY.startButton }));
    await answer('nearby-scan', { ok: false, reason: 'disabled' });
    expect(emitted('request-join')).toEqual([]);
    expect(screen.queryByRole('button', { name: NEARBY.startButton })).toBeNull();
    expect(toggle()).toBeNull();
  });

  it('in a group: shown to the Group Lead', async () => {
    await inGroup({ role: 'OWNER' });
    expect(screen.getByTestId('nearby-button')).toBeTruthy();
  });

  it('in a group: shown to a moderator', async () => {
    await inGroup({ role: 'MEMBER', moderator: true });
    expect(screen.getByTestId('nearby-button')).toBeTruthy();
  });

  it('in a group: not shown to a member', async () => {
    await inGroup({ role: 'MEMBER' });
    expect(screen.queryByTestId('nearby-button')).toBeNull();
  });

  it("in a group: scans from the presser's position; too rough, empty and the rate limit each say so", async () => {
    const roomCode = await inGroup({ role: 'OWNER' });
    fireEvent.click(screen.getByTestId('nearby-button'));
    await act(async () => currents.at(-1)({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 30 } }));
    await flush();
    expect(emitted('nearby-scan').at(-1)).toEqual({ roomCode, lat: A.lat, lng: A.lng, accuracy: 30 });
    await answer('nearby-scan', { ok: true, hereUsable: false, people: [] });
    expect(screen.getByText(NEARBY.tooRough)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: NEARBY.scanAgain }));
    await act(async () => currents.at(-1)({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 5 } }));
    await flush();
    await answer('nearby-scan', { ok: true, hereUsable: true, people: [] });
    expect(screen.getByTestId('nearby-empty').textContent).toContain(NEARBY.empty);
    fireEvent.click(screen.getByRole('button', { name: NEARBY.scanAgain }));
    await act(async () => currents.at(-1)({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 5 } }));
    await flush();
    await answer('nearby-scan', { ok: false, reason: 'too-many', retryAfterSec: 20 });
    expect(screen.getByText(NEARBY.tooMany)).toBeTruthy();
  });

  it('Add all invites everyone, and each answer shows as it comes', async () => {
    const roomCode = await inGroup({ role: 'OWNER' });
    fireEvent.click(screen.getByTestId('nearby-button'));
    await act(async () => currents.at(-1)({ coords: { latitude: A.lat, longitude: A.lng, accuracy: 5 } }));
    await flush();
    await answer('nearby-scan', { ok: true, hereUsable: true, people: [{ id: 's1', name: 'Bo' }, { id: 's2', name: 'Cy' }] });
    fireEvent.click(screen.getByRole('button', { name: NEARBY.addAll(2) }));
    expect(emitted('nearby-invite')).toEqual([{ roomCode, all: true }]);
    await answer('nearby-invite', { ok: true, invited: 2, sent: [{ id: 's1', inviteId: 'i1' }, { id: 's2', inviteId: 'i2' }] });
    act(() => fakeSocket.receive('nearby-invite-answered', { roomCode, inviteId: 'i1', name: 'Bo', accepted: true }));
    act(() => fakeSocket.receive('nearby-invite-answered', { roomCode, inviteId: 'i2', name: 'Cy', accepted: false, expired: true }));
    expect(screen.getAllByTestId('nearby-row-status').map((n) => n.textContent)).toEqual(['Joined', 'Invite expired']);
    expect(screen.getByText(NEARBY.joinedNotice('Bo'))).toBeTruthy();
  });
});
