// @vitest-environment jsdom
//
// Item 10 of the 2026-10 bug batch, through the real App.jsx: positions are shown exactly as
// reported (the GPS Kalman filter is gone), and a member whose connection drops stays at their
// last known location however long they are gone and however fast they were moving (the
// dead-reckoning "projection" is gone). The map stub shows what App hands it.
// Only the app's edges are stubbed (socket, Firebase, native plugins, the maps, update hooks).
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
    timeout: () => ({ emit: vi.fn() }),
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
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
  signOut: vi.fn(() => Promise.resolve()),
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
// A stand-in for the free map that shows what App tells it: whether the dots are on, and a
// dot to tap.
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: (props) => (
    <div
      data-testid="leaflet-stub"
      data-me={JSON.stringify(props.liveLocation)}
      data-users={JSON.stringify(props.users.map((u) => ({ id: u.id, lat: u.lat, lng: u.lng })))}
      data-ghosts={JSON.stringify(props.ghostMembers.map((g) => ({ id: g.id, position: g.position, phase: g.phase })))}
    />
  ),
}));
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
let code;
const bravo = () => ({
  'sock-Bravo': { uid: 'u-Bravo', name: 'Bravo', roomCode: code, lat: HERE.lat + 0.001, lng: HERE.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now() },
});
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const currentTab = () => tabBar().getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.textContent;
// jsdom has no layout: say whether the screen is a phone's (the app asks matchMedia).
const screenIs = (phone) => {
  window.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
};
const dots = () => screen.getByTestId('leaflet-stub').getAttribute('data-dots');

const onTheMap = async ({ cameraKnown = true } = {}) => {
  if (cameraKnown) localStorage.setItem('locus.cameraAllowed', '1');
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  act(() => fakeSocket.receive('users-update', bravo()));
  await screen.findByTestId('leaflet-stub');
};

beforeEach(() => {
  screenIs(true);
  localStorage.clear();
  sessionStorage.clear();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
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
  delete navigator.geolocation;
});

const stub = () => screen.getByTestId('leaflet-stub');
const shown = (attr) => JSON.parse(stub().getAttribute(attr));

describe('positions on the map', () => {
  it("are a member's, exactly as reported, however far they moved", async () => {
    await onTheMap();
    const far = { lat: HERE.lat + 0.01, lng: HERE.lng + 0.01 }; // about 1.5 km on
    act(() => fakeSocket.receive('users-update', { 'sock-Bravo': { ...bravo()['sock-Bravo'], ...far } }));
    expect(shown('data-users')).toEqual([{ id: 'sock-Bravo', ...far }]);
  });

  it("are this phone's own, exactly as the fix", async () => {
    localStorage.setItem('locus.locationAllowed', '1'); // location already allowed: no explainer first
    await onTheMap();
    expect(shown('data-me')).toMatchObject({ lat: HERE.lat, lng: HERE.lng });
  });
});

describe('a member whose connection is lost', () => {
  const lost = {
    targetId: 'sock-Bravo', uid: 'u-Bravo', name: 'Bravo',
    // Moving fast, due east: the old projection carried them on along this.
    lastKnownLocation: { latitude: 12.8240, longitude: 80.0440, speed: 18, heading: 90, batteryLevel: 50 },
    timeDelta: 20,
    disconnectTime: new Date().toISOString(),
  };

  it('stays exactly at their last known location, for as long as they are gone', async () => {
    await onTheMap();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
    act(() => fakeSocket.receive('member-signal-lost', lost));
    const at = { lat: 12.8240, lng: 80.0440 };
    for (const seconds of [0, 30, 90, 600]) {
      act(() => { vi.advanceTimersByTime(seconds * 1000); });
      const [ghost] = shown('data-ghosts');
      expect(ghost.position).toEqual(at);
    }
    // And says how long: "last seen" once a while has passed.
    expect(shown('data-ghosts')[0].phase).toBe('expired');
    vi.useRealTimers();
  });
});

// Hidden means hidden (found with item 14 of the 2026-10 batch): the app used to keep sending its
// exact position every few seconds while Hidden, and the server relayed it to the whole group.
describe('sharing as Hidden', () => {
  const sentAfter = (from) => fakeSocket.emit.mock.calls.slice(from);

  it('sends the status, but no position, from any source', async () => {
    localStorage.setItem('locus.locationAllowed', '1');
    // Before the app starts, so its heartbeat runs on the test's clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    await onTheMap();
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    const from = fakeSocket.emit.mock.calls.length;
    fireEvent.click(screen.getByRole('radio', { name: 'Hidden' }));
    // A movement report, and a few heartbeats.
    const watch = navigator.geolocation.watchPosition.mock.calls.at(-1)[0];
    await act(async () => { await watch({ coords: { latitude: HERE.lat + 0.002, longitude: HERE.lng, speed: 1, accuracy: 5 } }); });
    act(() => { vi.advanceTimersByTime(20000); });
    await act(async () => {});
    const sent = sentAfter(from);
    const updates = sent.filter(([e]) => e === 'update-location').map(([, p]) => p);
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update.status).toBe('GHOST');
      expect(update).not.toHaveProperty('lat');
      expect(update).not.toHaveProperty('lng');
    }
    expect(sent.filter(([e]) => e === 'safety-ping')).toEqual([]);
    vi.useRealTimers();
  });
});
