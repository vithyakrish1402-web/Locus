// @vitest-environment jsdom
//
// Item 6 of the 2026-10 bug batch, through the real App.jsx: tapping a member's card (or an
// incoming SOS) glides the map to that member at FOCUS_ZOOM_LEVEL and rings their marker, which
// clears after FOCUS_HIGHLIGHT_MS (counted once no SOS is up) or on a tap on the map. The map
// stub reports which member App asked it to highlight; utils/mapFocus.js gets a fake driver.
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
    <div data-testid="leaflet-stub" data-focused={props.focusedMemberId ?? ''}>
      <button type="button" data-testid="stub-map-tap" onClick={() => props.onMapClick({ lat: 12.8, lng: 80.04 })}>map</button>
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
const { registerMapDriver, FOCUS_ZOOM_LEVEL, FOCUS_HIGHLIGHT_MS } = await import('../src/utils/mapFocus.js');
const { SOS_RECEIVED } = await import('../src/copy/emergency.js');

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

// The camera, as utils/mapFocus.js drives it: every glide asked for, finished at once.
let flown;
let unregister;
beforeEach(() => {
  flown = [];
  unregister = registerMapDriver({
    element: null,
    getView: () => ({ lat: 12.82, lng: 80.04, zoom: 17 }),
    setView: () => {},
    fly: (target, _ms, done) => { flown.push(target); done(); return () => {}; },
  });
});
afterEach(() => unregister?.());

const focused = () => screen.getByTestId('leaflet-stub').getAttribute('data-focused');
const openMembers = () => fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));

describe('tapping a member card', () => {
  it('closes the panel, glides to them, zoomed in, and highlights their marker', async () => {
    await onTheMap();
    openMembers();
    fireEvent.click(screen.getAllByTestId('member-row')[0]);
    expect(currentTab()).toBe('Map');
    expect(focused()).toBe('sock-Bravo');
    expect(flown).toEqual([{ lat: HERE.lat + 0.001, lng: HERE.lng, zoom: FOCUS_ZOOM_LEVEL }]);
  });

  it('leaves the options to the ⋮ button', async () => {
    await onTheMap();
    openMembers();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
    expect(await screen.findByRole('dialog', { name: /Bravo/ })).toBeTruthy();
    expect(focused()).toBe('');
    expect(flown).toEqual([]);
  });

  it('lets the highlight go after FOCUS_HIGHLIGHT_MS', async () => {
    await onTheMap();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    openMembers();
    fireEvent.click(screen.getAllByTestId('member-row')[0]);
    act(() => { vi.advanceTimersByTime(FOCUS_HIGHLIGHT_MS - 1); });
    expect(focused()).toBe('sock-Bravo');
    act(() => { vi.advanceTimersByTime(1); });
    expect(focused()).toBe('');
    vi.useRealTimers();
  });

  it('lets the highlight go on a tap on the map', async () => {
    await onTheMap();
    openMembers();
    fireEvent.click(screen.getAllByTestId('member-row')[0]);
    fireEvent.click(screen.getByTestId('stub-map-tap'));
    expect(focused()).toBe('');
  });

  it('does the same from Show on map in the options', async () => {
    localStorage.setItem('locus.locationAllowed', '1'); // so this phone has a fix, and the sheet a "where"
    await onTheMap();
    openMembers();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
    fireEvent.click(await screen.findByText('Show on map'));
    expect(focused()).toBe('sock-Bravo');
    expect(flown).toHaveLength(1);
  });
});

describe('an incoming SOS', () => {
  const sos = { id: 'sos-1', senderId: 'sock-Bravo', senderName: 'Bravo', lat: 12.8261, lng: 80.0471, timestamp: Date.now(), ageMs: 0 };

  it('glides to where it was sent from and highlights the sender, until a while after it is acknowledged', async () => {
    await onTheMap();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => fakeSocket.receive('sos-received', sos));
    expect(flown).toEqual([{ lat: sos.lat, lng: sos.lng, zoom: FOCUS_ZOOM_LEVEL }]);
    expect(focused()).toBe('sock-Bravo');
    // Not cleared while the alert is still on screen, however long it stays.
    act(() => { vi.advanceTimersByTime(FOCUS_HIGHLIGHT_MS * 3); });
    expect(focused()).toBe('sock-Bravo');
    fireEvent.click(screen.getByRole('button', { name: SOS_RECEIVED.acknowledge }));
    act(() => { vi.advanceTimersByTime(FOCUS_HIGHLIGHT_MS); });
    expect(focused()).toBe('');
    vi.useRealTimers();
  });

  it('is focused once: not again on a re-render, nor when the same alert is updated', async () => {
    await onTheMap();
    act(() => fakeSocket.receive('sos-received', sos));
    act(() => fakeSocket.receive('users-update', bravo()));
    // The sender pressed again: same alert, newer position. The map stays where the user has it.
    act(() => fakeSocket.receive('sos-updated', { ...sos, lat: 12.8270, lng: 80.0480 }));
    expect(flown).toHaveLength(1);
  });
});
