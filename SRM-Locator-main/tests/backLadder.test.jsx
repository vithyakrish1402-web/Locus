// @vitest-environment jsdom
//
// Android Back through the real App.jsx (item 1 of the 2026-10 bug batch): each press closes the
// top-most overlay, then steps back a level, then returns to the map; only on the map does it
// fall through (to "press back again to exit", in hooks/useBackButtonGuard.js). Back used to
// leave the app from everywhere but AR Scan. runBackHandler() is what the Back listener calls.
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
    <div data-testid="leaflet-stub" data-dots={String(props.showBuildings)}>
      <button type="button" data-testid="stub-dot" onClick={() => props.onFocus({ lat: props.places[0].lat, lng: props.places[0].lng }, props.places[0])}>dot</button>
    </div>
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
const { runBackHandler } = await import('../src/utils/backHandlers.js');

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

const back = () => { let took; act(() => { took = runBackHandler(); }); return took; };

describe('Android Back', () => {
  it('falls through on the map with nothing open, to "press again to exit"', async () => {
    await onTheMap();
    expect(back()).toBe(false);
  });

  it('goes from the Group tab back to the map, and only then falls through', async () => {
    await onTheMap();
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    expect(currentTab()).toBe('Group');
    expect(back()).toBe(true);
    expect(currentTab()).toBe('Map');
    expect(back()).toBe(false);
  });

  it("closes a member's options first, then the Group panel", async () => {
    await onTheMap();
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    fireEvent.click(screen.getAllByTestId('member-row')[0]);
    expect(await screen.findByRole('dialog', { name: /Bravo/ })).toBeTruthy();
    expect(back()).toBe(true);
    await act(async () => {});
    expect(screen.queryByRole('dialog', { name: /Bravo/ })).toBeNull();
    expect(currentTab()).toBe('Group');
    expect(back()).toBe(true);
    expect(currentTab()).toBe('Map');
  });

  it('closes Settings', async () => {
    await onTheMap();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByTestId('settings-layer')).toBeTruthy();
    expect(back()).toBe(true);
    await act(async () => {});
    expect(screen.queryByTestId('settings-layer')).toBeNull();
    expect(back()).toBe(false);
  });

  it("closes a place's card", async () => {
    await onTheMap();
    fireEvent.click(screen.getByTestId('stub-dot'));
    expect(await screen.findByTestId('place-navigate')).toBeTruthy();
    expect(back()).toBe(true);
    await act(async () => {});
    expect(screen.queryByTestId('location-card')).toBeNull();
  });

  it('stops choosing a meeting point', async () => {
    await onTheMap();
    fireEvent.click(screen.getByRole('button', { name: /meeting point/i }));
    expect(screen.getByText(/tap the map/i)).toBeTruthy();
    expect(back()).toBe(true);
    await act(async () => {});
    expect(screen.queryByText(/tap the map/i)).toBeNull();
  });
});
