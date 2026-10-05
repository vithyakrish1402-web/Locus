// @vitest-environment jsdom
//
// Location sharing modes: ACTIVE (Live), FROZEN (Paused), GHOST (Hidden).
//
// FROZEN used to freeze nothing. Only the movement-driven GPS reports stopped; the
// heartbeat went on sending 'update-location' with the live fix every polling interval,
// and its 'safety-ping' (which feeds the Commander's telemetry matrix) carried the live fix
// too. So the squad followed a "frozen" member around in near-real time.
//
// Paused now means: the squad keeps the position taken the moment sharing was paused, and
// nothing newer leaves the phone as a squad position. An SOS is the exception, on purpose:
// it always carries where the sender is now. GHOST is deliberately left as it was.
//
// Renders the real App.jsx; only the socket transport, Firebase, native plugins, maps and
// the update hooks are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

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
const { SETTINGS } = await import('../src/copy/settings.js');

// Three spots about 150 m apart, so "close to" (about 20 m) can't confuse one with another.
const A = { lat: 12.8230, lng: 80.0440 };
const B = { lat: 12.8240, lng: 80.0450 };
const C = { lat: 12.8250, lng: 80.0460 };
const near = (p, spot) => Math.abs(p.lat - spot.lat) < 0.0002 && Math.abs(p.lng - spot.lng) < 0.0002;
const nearLatLng = (p, spot) => near({ lat: p.latitude, lng: p.longitude }, spot);

const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, payload]) => payload);
const clearEmits = () => fakeSocket.emit.mockClear();
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

let watchCallback = null;
// Standing at a spot for a dozen fixes: the app's Kalman filter only moves part of the way
// to each new fix once it has settled, so one fix alone would land short of the spot. The
// watch callback is async (it awaits getBattery before deciding what to send).
const moveToAndSettle = (spot) => act(async () => {
  for (let i = 0; i < 12; i += 1) {
    await watchCallback({ coords: { latitude: spot.lat, longitude: spot.lng, speed: 0 } });
  }
});

let squadCode;
// Signed in -> lobby -> INITIALIZE (Commander, granted) with a first fix at A, then the SQUAD
// panel, where the ACTIVE / FROZEN / GHOST buttons are.
const inSquadAt = async (spot) => {
  navigator.geolocation.getCurrentPosition.mockImplementation((ok) => ok({ coords: { latitude: spot.lat, longitude: spot.lng, speed: 0 } }));
  render(<App />);
  squadCode = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: squadCode }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
};
const setMode = (mode) => fireEvent.click(screen.getByRole('button', { name: mode }));

// The SOS button's full gesture: hold 1.2 s to arm, release, hold 1.2 s again to send.
const sendSos = () => {
  const sos = screen.getByRole('button', { name: /arm SOS beacon/i });
  fireEvent.pointerDown(sos, { button: 0 });
  advance(1200);
  fireEvent.pointerUp(sos, { button: 0 });
  const armed = screen.getByRole('button', { name: /confirm SOS beacon/i });
  fireEvent.pointerDown(armed, { button: 0 });
  advance(1200);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
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

describe('Paused sharing (FROZEN)', () => {
  it('Live -> Paused -> Live: the squad keeps the paused spot, then follows again at once', async () => {
    await inSquadAt(A);
    await moveToAndSettle(B);
    expect(emitted('update-location').at(-1)).toMatchObject({ status: 'ACTIVE' });
    expect(near(emitted('update-location').at(-1), B)).toBe(true);

    // Pausing sends the spot you paused at, once, marked FROZEN.
    clearEmits();
    setMode('FROZEN');
    const onPause = emitted('update-location');
    expect(onPause).toHaveLength(1);
    expect(onPause[0]).toMatchObject({ status: 'FROZEN' });
    expect(near(onPause[0], B)).toBe(true);

    // Walking on, and several heartbeats later: no GPS report at all, and the heartbeat's
    // own position (the Commander's matrix) stays on the paused spot, timed at the pause.
    clearEmits();
    const pausedAt = Date.now();
    await moveToAndSettle(C);
    advance(16000);
    await act(async () => {});
    expect(emitted('update-location')).toEqual([]);
    const beats = emitted('safety-ping');
    expect(beats.length).toBeGreaterThanOrEqual(3);
    beats.forEach((beat) => {
      expect(nearLatLng(beat, B)).toBe(true);
      expect(Math.abs(new Date(beat.timestamp).getTime() - pausedAt)).toBeLessThan(1000);
    });

    // Back to Live: where you are now goes out straight away, not at the next heartbeat.
    clearEmits();
    setMode('ACTIVE');
    const onResume = emitted('update-location');
    expect(onResume).toHaveLength(1);
    expect(onResume[0]).toMatchObject({ status: 'ACTIVE' });
    expect(near(onResume[0], C)).toBe(true);

    // ...and the heartbeat carries the live fix again.
    clearEmits();
    advance(5000);
    await act(async () => {});
    expect(near(emitted('update-location').at(-1), C)).toBe(true);
    expect(nearLatLng(emitted('safety-ping').at(-1), C)).toBe(true);
  });

  it('does not leak a new fix when a setting change restarts location tracking', async () => {
    await inSquadAt(A);
    setMode('FROZEN');
    navigator.geolocation.getCurrentPosition.mockImplementation((ok) => ok({ coords: { latitude: C.lat, longitude: C.lng, speed: 0 } }));
    clearEmits();

    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${SETTINGS.refreshOptions.eco.label}`) }));
    await act(async () => {});

    expect(emitted('update-location')).toEqual([]);
  });

  it('after a reconnect, hands the squad the paused spot again, not the current one', async () => {
    await inSquadAt(A);
    await moveToAndSettle(B);
    setMode('FROZEN');
    await moveToAndSettle(C);
    clearEmits();

    // A new socket: the server re-admits the member, but has no position for them yet.
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: squadCode }));

    const sent = emitted('update-location');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ status: 'FROZEN', roomCode: squadCode });
    expect(near(sent[0], B)).toBe(true);
  });

  it('a paused member with no fix when pausing sends no position at all', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    squadCode = undefined;
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    setMode('FROZEN');

    await moveToAndSettle(C);
    advance(16000);
    await act(async () => {});

    expect(emitted('update-location')).toEqual([]);
    expect(emitted('safety-ping')).toEqual([]);
  });
});

describe('an SOS while sharing is paused or hidden', () => {
  it.each(['FROZEN', 'GHOST'])('%s: carries where the sender is now, and leaves the mode as it was', async (mode) => {
    await inSquadAt(A);
    await moveToAndSettle(B);
    setMode(mode);
    await moveToAndSettle(C);
    clearEmits();

    sendSos();

    const sos = emitted('sos-broadcast');
    expect(sos).toHaveLength(1);
    expect(near(sos[0], C)).toBe(true);

    // Still in the same mode: the heartbeat after the SOS behaves exactly as before it.
    clearEmits();
    advance(5000);
    await act(async () => {});
    expect(emitted('update-location')).toEqual([]);
    expect(screen.getByRole('button', { name: mode }).className).toMatch(/border-(blue|zinc)-500/);
  });
});

describe('Hidden (GHOST), unchanged for now', () => {
  it('still sends the heartbeat with the live fix, no heartbeat GPS report, and movement reports marked GHOST', async () => {
    await inSquadAt(A);
    setMode('GHOST');
    await moveToAndSettle(B);

    // The movement report still goes out, marked GHOST (other members' apps drop it).
    const moved = emitted('update-location').at(-1);
    expect(moved).toMatchObject({ status: 'GHOST' });
    expect(near(moved, B)).toBe(true);

    clearEmits();
    advance(5000);
    await act(async () => {});
    expect(emitted('update-location')).toEqual([]);
    expect(nearLatLng(emitted('safety-ping').at(-1), B)).toBe(true);
  });
});
