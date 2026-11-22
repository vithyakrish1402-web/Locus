// @vitest-environment jsdom
//
// Request to leave in the real App.jsx (Stage 5), with the app's switch on.
// Only the socket, Firebase, native plugins, maps and the update hooks are stubbed.
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

vi.mock('../src/utils/leaveRequests.js', async (importOriginal) => ({ ...(await importOriginal()), LEAVE_APPROVAL_ENABLED: true }));

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

describe('a member, in a Group whose Leave is a request', () => {
  it('sees "Request to leave", and asking shows a calm wait with the time left, by the server\'s clock', async () => {
    await inGroup();
    expect(leaveButton().textContent).toBe(LEAVE_REQUEST.button);
    await confirmIn(LEAVE_REQUEST.confirm);
    expect(emitted('request-leave')).toEqual([{ roomCode }]);
    expect(emitted('leave-squad')).toEqual([]);
    const deadline = serverNow() + 15 * MIN;
    await answer('request-leave', { ok: true, requestedAt: serverNow(), deadline, serverNow: serverNow() });
    expect(screen.getByText(LEAVE_REQUEST.waitingTitle)).toBeTruthy();
    expect(screen.getByTestId('leave-request-countdown').textContent).toBe(LEAVE_REQUEST.waitingBody('15:00', clockLabel(deadline, SKEW)));
    expect(screen.queryByTestId('leave-group')).toBeNull();
  });

  it('can cancel it, and is back to a normal member', async () => {
    await inGroup();
    act(() => fakeSocket.receive('leave-request-pending', { roomCode, requestedAt: serverNow(), deadline: serverNow() + 15 * MIN, serverNow: serverNow() }));
    fireEvent.click(screen.getByRole('button', { name: LEAVE_REQUEST.cancel }));
    expect(emitted('cancel-leave')).toEqual([{ roomCode }]);
    await answer('cancel-leave', { ok: true });
    act(() => fakeSocket.receive('leave-request-cancelled', { roomCode, reason: 'cancelled' }));
    expect(screen.queryByTestId('leave-request-waiting')).toBeNull();
    expect(leaveButton().textContent).toBe(LEAVE_REQUEST.button);
    expect(screen.getByText(LEAVE_REQUEST.cancelled)).toBeTruthy();
  });

  it('opened again mid-request: the wait and its deadline come back from the server', async () => {
    await inGroup();
    const deadline = serverNow() + 9 * MIN;
    act(() => fakeSocket.receive('leave-request-pending', { roomCode, requestedAt: serverNow() - 6 * MIN, deadline, serverNow: serverNow() }));
    expect(screen.getByTestId('leave-request-countdown').textContent).toBe(LEAVE_REQUEST.waitingBody('9:00', clockLabel(deadline, SKEW)));
  });

  it('approved: back to the lobby, told in a short notice', async () => {
    await inGroup();
    act(() => fakeSocket.receive('leave-request-pending', { roomCode, requestedAt: serverNow(), deadline: serverNow() + MIN, serverNow: serverNow() }));
    await act(async () => fakeSocket.receive('leave-approved', { roomCode, auto: true }));
    expect(screen.getByText(LEAVE_REQUEST.approvedAuto)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create group' })).toBeTruthy());
  });

  it('rejected: stays, and is told', async () => {
    await inGroup();
    act(() => fakeSocket.receive('leave-request-pending', { roomCode, requestedAt: serverNow(), deadline: serverNow() + MIN, serverNow: serverNow() }));
    act(() => fakeSocket.receive('leave-rejected', { roomCode, byName: 'Asha' }));
    expect(screen.getByText(LEAVE_REQUEST.rejected('Asha'))).toBeTruthy();
    expect(leaveButton().textContent).toBe(LEAVE_REQUEST.button);
  });

  it('gone: told plainly', async () => {
    await inGroup();
    act(() => fakeSocket.receive('leave-request-pending', { roomCode, requestedAt: serverNow(), deadline: serverNow() + MIN, serverNow: serverNow() }));
    act(() => fakeSocket.receive('leave-request-withdrawn', { roomCode, uid: 'u-self', reason: 'gone' }));
    expect(screen.getByText(LEAVE_REQUEST.gone)).toBeTruthy();
  });

  it('may sign out while waiting: told they stay a member and their sharing stops', async () => {
    await inGroup();
    act(() => fakeSocket.receive('leave-request-pending', { roomCode, requestedAt: serverNow(), deadline: serverNow() + 15 * MIN, serverNow: serverNow() }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(emitted('leave-squad').length).toBeGreaterThan(0);
    expect(screen.getByText(LEAVE_REQUEST.signedOut)).toBeTruthy();
  });

  it('if the server says the Group does not need a request after all, leaves as before', async () => {
    await inGroup();
    await confirmIn(LEAVE_REQUEST.confirm);
    await answer('request-leave', { ok: false, reason: 'not-required' });
    expect(emitted('leave-squad').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create group' })).toBeTruthy());
  });
});

describe('Leave as before', () => {
  it('in a Group that does not need a request', async () => {
    await inGroup({ gated: false });
    expect(leaveButton().textContent).toBe('Leave group');
    await confirmIn('Leave group');
    expect(emitted('request-leave')).toEqual([]);
    expect(emitted('leave-squad').length).toBeGreaterThan(0);
  });

  it('for whoever holds command, even in a Group that needs one', async () => {
    await inGroup({ role: 'OWNER' });
    expect(leaveButton().textContent).toBe('Leave group');
    await confirmIn('Leave group');
    expect(emitted('request-leave')).toEqual([]);
    expect(emitted('leave-squad').length).toBeGreaterThan(0);
  });
});

describe('the Group Lead', () => {
  const request = (uid, extra = {}) => ({ roomCode, uid, name: uid, requestedAt: serverNow(), deadline: serverNow() + 14 * MIN, fromModerator: false, fromCommander: false, serverNow: serverNow(), ...extra });

  it('sees the waiting list with Approve and Reject; the Commander\'s own has no Reject; a moderator\'s says so', async () => {
    await inGroup({ role: 'OWNER' });
    expect(emitted('get-leave-requests')).toEqual([{ roomCode }]);
    await answer('get-leave-requests', { ok: true, serverNow: serverNow(), requests: [request('Ann'), request('Cmdr', { fromCommander: true }), request('Mo', { fromModerator: true })] });
    const tile = screen.getByText(LEAVE_REQUESTS.tile).closest('button');
    expect(within(tile).getByLabelText('3 waiting')).toBeTruthy();
    fireEvent.click(tile);
    const list = await screen.findByTestId('leave-requests');
    expect(within(list).getAllByTestId('leave-request')).toHaveLength(3);
    expect(within(list).queryByRole('button', { name: LEAVE_REQUESTS.rejectFor('Cmdr') })).toBeNull();
    expect(within(list).getByText(LEAVE_REQUESTS.commanderRule)).toBeTruthy();
    expect(within(list).getByText(LEAVE_REQUESTS.moderatorRule)).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: LEAVE_REQUESTS.approveFor('Ann') }));
    expect(emitted('resolve-leave')).toEqual([{ roomCode, uid: 'Ann', approved: true }]);
    await answer('resolve-leave', { ok: true });
    expect(within(screen.getByTestId('leave-requests')).getAllByTestId('leave-request')).toHaveLength(2);
  });

  it('a new request shows a notice, and the count on the Group tab', async () => {
    await inGroup({ role: 'OWNER' });
    await answer('get-leave-requests', { ok: true, serverNow: serverNow(), requests: [] });
    act(() => fakeSocket.receive('leave-request', request('Bea')));
    expect(screen.getByText(LEAVE_REQUESTS.newNotice('Bea'))).toBeTruthy();
    expect(screen.getAllByLabelText('1 waiting').length).toBeGreaterThan(0);
  });
});
