// @vitest-environment jsdom
//
// Two phone glitches from the v1.1.69 screen recording, through the real App.jsx:
//  - The campus dots vanished after a visit to Group and never came back (they were drawn only
//    for the Members/Buildings tab the Group tab had switched away from).
//  - The Scan tab stayed highlighted after AR Scan closed.
//  - With the keyboard up (a search field focused) the tab bar and the meeting point button
//    rode up on top of it; they step aside now, and the Emergency button stays.
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

describe('the campus dots on a phone', () => {
  it('are on when the map opens', async () => {
    await onTheMap();
    expect(dots()).toBe('true');
  });

  it('stay on after visiting Group, Scan and Settings and coming back to the map', async () => {
    await onTheMap();

    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    fireEvent.click(tabBar().getByRole('button', { name: 'Map' }));
    expect(dots()).toBe('true');

    fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
    fireEvent.click(screen.getByRole('button', { name: 'Close AR Scan' }));
    expect(dots()).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(dots()).toBe('true');
  });

  it('show the place card when one is tapped while the sheet last showed Members', async () => {
    await onTheMap();
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    fireEvent.click(tabBar().getByRole('button', { name: 'Map' }));
    expect(screen.queryByTestId('place-navigate')).toBeNull();
    fireEvent.click(screen.getByTestId('stub-dot'));
    expect(await screen.findByTestId('place-navigate')).toBeTruthy();
  });
});

describe('the campus dots on a larger screen', () => {
  it("still follow the sidebar's tab: hidden for Members, back for Buildings", async () => {
    screenIs(false);
    await onTheMap();
    expect(dots()).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    expect(dots()).toBe('false');
    fireEvent.click(screen.getByRole('radio', { name: 'Buildings' }));
    expect(dots()).toBe('true');
  });
});

describe('the tab bar after AR Scan closes', () => {
  const openScan = async (opts) => {
    await onTheMap(opts);
    fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
    expect(currentTab()).toBe('Scan');
  };

  it('highlights Map again when AR Scan is closed with its ✕', async () => {
    await openScan();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
    expect(currentTab()).toBe('Scan');
    fireEvent.click(screen.getByRole('button', { name: 'Close AR Scan' }));
    expect(screen.queryByTestId('ar-scan')).toBeNull();
    expect(currentTab()).toBe('Map');
  });

  it("highlights Map again after the start screen's Cancel", async () => {
    await openScan();
    fireEvent.click(within(screen.getByTestId('ar-start')).getByRole('button', { name: 'Cancel' }));
    expect(currentTab()).toBe('Map');
  });

  it("highlights Map again after the camera explainer's Not now", async () => {
    await openScan({ cameraKnown: false });
    fireEvent.click(within(screen.getByTestId('camera-explainer')).getByRole('button', { name: 'Not now' }));
    expect(currentTab()).toBe('Map');
  });

  it('closes AR Scan on Back and highlights Map', async () => {
    await openScan();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
    expect(screen.getByTestId('ar-scan')).toBeTruthy();
    act(() => { expect(runBackHandler()).toBe(true); });
    expect(screen.queryByTestId('ar-scan')).toBeNull();
    expect(currentTab()).toBe('Map');
  });

  it('leaves Back alone when AR Scan is not open', async () => {
    await onTheMap();
    expect(runBackHandler()).toBe(false);
    fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
    fireEvent.click(within(screen.getByTestId('ar-start')).getByRole('button', { name: 'Cancel' }));
    expect(runBackHandler()).toBe(false); // the handler is gone with AR Scan
  });
});

describe('with the keyboard up', () => {
  const openSearch = async () => {
    fireEvent.click(screen.getByTestId('top-bar-search-open'));
    await act(async () => {});
    return screen.getByTestId('top-bar-search');
  };

  it('hides the tabs and the meeting point button, keeps the Emergency button, and returns them after', async () => {
    await onTheMap();
    expect(screen.getByTestId('meeting-point-button')).toBeTruthy();
    const box = await openSearch();
    act(() => box.focus());
    expect(screen.getByTestId('tab-bar-tabs').className).toContain('hidden');
    expect(screen.queryByTestId('meeting-point-button')).toBeNull();
    expect(tabBar().getByTestId('sos-button')).toBeTruthy();

    act(() => box.blur());
    expect(screen.getByTestId('tab-bar-tabs').className).not.toContain('hidden');
    expect(screen.getByTestId('meeting-point-button')).toBeTruthy();
  });

  it('lets go of the search field when its close mark is pressed', async () => {
    await onTheMap();
    const box = await openSearch();
    act(() => box.focus());
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(document.activeElement).not.toBe(box);
    expect(screen.getByTestId('meeting-point-button')).toBeTruthy();
  });
});
