// @vitest-environment jsdom
//
// Timed Pause and Hidden in the real App.jsx (Stage 4), with the app's switch on: the sharing
// control asks the server, follows what it says, falls back to js-1.1.87's behaviour when the
// server's own switch is off, takes a hold back up on reopening, and an SOS ends a hold at once.
// Only the socket, Firebase, native plugins, maps and the update hooks are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';
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

vi.mock('../src/utils/timedPrivacy.js', async (importOriginal) => ({ ...(await importOriginal()), TIMED_PRIVACY_ENABLED: true }));
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
const { TIMED_PRIVACY } = await import('../src/copy/group.js');
const { clockLabel } = await import('../src/utils/timedPrivacy.js');
const { __resetNotifications } = await import('../src/utils/notify.js');
const { rememberLocationAllowed } = await import('../src/utils/locationPermission.js');

const MIN = 60_000;
const SKEW = MIN; // the server is a minute ahead of the phone
const A = { lat: 12.8230, lng: 80.0440 };

const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, payload]) => payload);
const lastStatus = () => emitted('update-location').at(-1)?.status;
const answer = (reply) => act(async () => {
  const call = fakeSocket.emit.mock.calls.filter(([e]) => e === 'set-sharing-mode').at(-1);
  call[2](reply);
});
const serverNow = () => Date.now() + SKEW;
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

let watchCallback = null;
let roomCode;
const fixAt = (spot, accuracy = 6) => act(async () => {
  await watchCallback({ coords: { latitude: spot.lat, longitude: spot.lng, speed: 0, accuracy } });
});

// Signed in -> lobby -> Create group (granted), with a first fix, then the Members panel, where the
// sharing control is.
const inGroup = async () => {
  navigator.geolocation.getCurrentPosition.mockImplementation((ok) => ok({ coords: { latitude: A.lat, longitude: A.lng, speed: 0, accuracy: 6 } }));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  roomCode = emitted('request-join').at(-1).roomCode;
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode }));
  await act(async () => {});
  await fixAt(A);
  fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
};
const pick = (label) => fireEvent.click(screen.getByRole('radio', { name: label }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
  localStorage.clear();
  sessionStorage.clear();
  rememberLocationAllowed(); // past the location explainer, as on a phone that allowed it before
  __resetNotifications();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  watchCallback = null;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn((cb) => { watchCallback = cb; return 1; }),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('picking Paused or Hidden', () => {
  it('asks how long, asks the server, and pauses only once it agrees, with a countdown by its clock', async () => {
    await inGroup();
    pick('Paused');
    expect(screen.getByTestId('duration-picker')).toBeTruthy();
    fakeSocket.emit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '10 min' }));
    expect(emitted('set-sharing-mode')).toEqual([{ roomCode, mode: 'FROZEN', minutes: 10 }]);
    expect(emitted('update-location')).toEqual([]); // still Live until the server says yes

    const until = serverNow() + 10 * MIN;
    await answer({ ok: true, mode: 'FROZEN', until, allowanceLeftMs: 20 * MIN, serverNow: serverNow() });
    expect(lastStatus()).toBe('FROZEN');
    expect(screen.getByTestId('hold-countdown').textContent).toBe(`Paused for 10:00 more, until ${clockLabel(until, SKEW)}`);
    expect(screen.getByTestId('sharing-allowance').textContent).toBe('20 min of Pause and Hidden left this hour');
  });

  it('refused: stays Live, and says how much is left in plain words', async () => {
    await inGroup();
    pick('Hidden');
    fakeSocket.emit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '30 min' }));
    await answer({ ok: false, reason: 'allowance', allowanceLeftMs: 4 * MIN });
    expect(emitted('update-location')).toEqual([]);
    expect(screen.getByText('Only 4 min of Pause and Hidden is left this hour. Pick that or less.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Live' }).getAttribute('aria-checked')).toBe('true');
  });

  it("with the server's switch off, does what js-1.1.87 did: paused at once, untimed, and no picker after", async () => {
    await inGroup();
    pick('Paused');
    fireEvent.click(screen.getByRole('button', { name: '5 min' }));
    await answer({ ok: false, reason: 'disabled' });
    expect(lastStatus()).toBe('FROZEN');
    expect(screen.queryByTestId('hold-countdown')).toBeNull();
    fakeSocket.emit.mockClear();
    pick('Hidden');
    expect(screen.queryByTestId('duration-picker')).toBeNull();
    expect(lastStatus()).toBe('GHOST');
    expect(emitted('set-sharing-mode')).toEqual([]);
  });
});

describe('a hold that is already running', () => {
  it('is taken back up when the app is opened again: Paused, with its countdown', async () => {
    await inGroup();
    const until = serverNow() + 7 * MIN;
    await act(async () => fakeSocket.receive('sharing-hold', { roomCode, mode: 'GHOST', until, allowanceLeftMs: 3 * MIN, serverNow: serverNow() }));
    expect(lastStatus()).toBe('GHOST');
    expect(screen.getByRole('radio', { name: 'Hidden' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('hold-countdown').textContent).toBe(`Hidden for 7:00 more, until ${clockLabel(until, SKEW)}`);
  });

  it.each([
    ['expired', TIMED_PRIVACY.ended.expired],
    ['resumed', TIMED_PRIVACY.ended.resumed],
    ['sos', TIMED_PRIVACY.ended.sos],
  ])('ended by the server (%s): Live again, and told so', async (reason, words) => {
    await inGroup();
    await act(async () => fakeSocket.receive('sharing-hold', { roomCode, mode: 'FROZEN', until: serverNow() + 7 * MIN, allowanceLeftMs: 3 * MIN, serverNow: serverNow() }));
    fakeSocket.emit.mockClear();
    await act(async () => fakeSocket.receive('sharing-hold-ended', { reason, endedMode: 'FROZEN', mode: 'ACTIVE', until: null, allowanceLeftMs: 5 * MIN, serverNow: serverNow() }));
    expect(lastStatus()).toBe('ACTIVE');
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByTestId('hold-countdown')).toBeNull();
  });

  it('an SOS shows the person as Live straight away, before the server says anything', async () => {
    await inGroup();
    await act(async () => fakeSocket.receive('sharing-hold', { roomCode, mode: 'GHOST', until: serverNow() + 7 * MIN, allowanceLeftMs: 3 * MIN, serverNow: serverNow() }));
    fakeSocket.emit.mockClear();
    const sos = screen.getAllByRole('button', { name: /arm SOS beacon/i })[0];
    fireEvent.pointerDown(sos, { button: 0 });
    advance(1200);
    fireEvent.pointerUp(sos, { button: 0 });
    const armed = screen.getAllByRole('button', { name: /confirm SOS beacon/i })[0];
    fireEvent.pointerDown(armed, { button: 0 });
    advance(1200);
    await act(async () => {});
    expect(emitted('sos-broadcast').length + fakeSocket.emit.mock.calls.length).toBeGreaterThan(0);
    expect(lastStatus()).toBe('ACTIVE');
    expect(screen.getByText(TIMED_PRIVACY.ended.sos)).toBeTruthy();
  });
});

describe('what goes to the server', () => {
  it('sends the GPS accuracy with every position', async () => {
    await inGroup();
    await fixAt({ lat: A.lat + 0.0001, lng: A.lng }, 9);
    expect(emitted('update-location').at(-1)).toMatchObject({ accuracy: 9, status: 'ACTIVE' });
  });
});

describe('other members', () => {
  it('a timed Pause shows until when, in this phone\'s clock; never a position for Hidden', async () => {
    await inGroup();
    const until = serverNow() + 9 * MIN;
    // The server's clock is learned from the person's own hold reply first.
    await act(async () => fakeSocket.receive('sharing-hold', { roomCode, mode: 'ACTIVE', until: null, allowanceLeftMs: 30 * MIN, serverNow: serverNow() }));
    act(() => fakeSocket.receive('users-update', {
      'self-socket': { uid: 'u-self', roomCode, name: 'Alpha', status: 'ACTIVE', hasFix: true, lat: A.lat, lng: A.lng, lastSeen: Date.now() },
      bravo: { uid: 'u-b', roomCode, name: 'Bravo', status: 'FROZEN', hasFix: true, lat: A.lat, lng: A.lng, lastSeen: Date.now(), holdUntil: until },
      charlie: { uid: 'u-c', roomCode, name: 'Charlie', status: 'GHOST', hasFix: false, lastSeen: Date.now(), holdUntil: until },
    }));
    await act(async () => {});
    const rows = screen.getAllByTestId('member-row');
    const row = (name) => rows.find((r) => within(r).queryByText(name));
    expect(within(row('Bravo')).getByTestId('member-status').textContent).toBe(`Paused until ${clockLabel(until, SKEW)}`);
    expect(within(row('Charlie')).getByTestId('member-status').textContent).toBe(`Hidden until ${clockLabel(until, SKEW)}`);
    expect(within(row('Charlie')).queryByTestId('member-where')).toBeNull();
  });
});
