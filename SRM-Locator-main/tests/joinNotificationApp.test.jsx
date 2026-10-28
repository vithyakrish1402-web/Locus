// @vitest-environment jsdom
//
// Item 13 (2026-10-24) in the real App.jsx: tapping the "N people waiting to join" notification
// that the sharing service raised while LOCUS was closed reaches the app as the LocusBackground
// plugin's "groupOpened", and opens the Group tab and, for whoever may let them in, Join requests.
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
const bg = vi.hoisted(() => ({ listeners: {} }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: (name) => (name === 'LocusBackground'
    ? { addListener: (event, fn) => { bg.listeners[event] = fn; return Promise.resolve({ remove: () => { delete bg.listeners[event]; } }); } }
    : {}),
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: () => Promise.resolve({ remove: () => {} }), minimizeApp: vi.fn() },
}));
vi.mock('google-map-react', () => ({ default: () => null }));
const exported = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve('shared')) }));
vi.mock('../src/utils/activityLogExport.js', async (importOriginal) => ({
  ...(await importOriginal()),
  exportActivityLog: exported.fn,
}));
// A stand-in for the free map that shows what App tells it: whether the dots are on, and a
// dot to tap.
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: (props) => (
    <div data-testid="leaflet-stub" data-dots={String(props.showBuildings)}>
      <button type="button" data-testid="stub-dot" onClick={() => props.onFocus({ lat: props.places[0].lat, lng: props.places[0].lng }, props.places[0])}>dot</button>
      <button type="button" data-testid="stub-map-click" onClick={() => props.onMapClick({ lat: 12.8231, lng: 80.0442 })}>map spot</button>
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
const { __resetNotifications, subscribe } = await import('../src/utils/notify.js');
const { NOTICES } = await import('../src/copy/notices.js');
const { ROLE_REFUSED, ACTIVITY_LOG, MEMBER_OPTIONS } = await import('../src/copy/group.js');
let feed = [];
subscribe((items) => { feed = items; });
const noticeUp = (text) => feed.some((n) => n.message === text || n.body === text);

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

const tapNotification = () => act(() => bg.listeners.groupOpened?.({}));

describe('tapping "people waiting to join"', () => {
  it('opens the Group tab and Join requests for the Group Lead', async () => {
    await onTheMap();
    act(() => fakeSocket.receive('access-request', { targetId: 'j1', name: 'Joiner 1', roomCode: code }));
    expect(currentTab()).toBe('Map');
    tapNotification();
    expect(currentTab()).toMatch(/Group$/); // the tab also shows the 1 waiting
    expect(await screen.findByTestId('join-requests')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve Joiner 1' })).toBeTruthy();
  });

  it('opens just the Group tab for a member', async () => {
    await onTheMap();
    act(() => fakeSocket.receive('demoted-to-member', { roomCode: code }));
    tapNotification();
    expect(currentTab()).toBe('Group');
    expect(screen.queryByTestId('join-requests')).toBeNull();
  });
});

describe('dedicated mobile sections', () => {
  it('returns to the map when a building is chosen, so its card is visible', async () => {
    await onTheMap();
    fireEvent.click(tabBar().getByRole('button', { name: 'Buildings' }));
    fireEvent.click(within(screen.getAllByTestId('building-row')[0]).getByRole('button', { name: /^View / }));
    expect(currentTab()).toBe('Map');
    expect(await screen.findByTestId('location-card')).toBeTruthy();
  });

  it('asks for a description before publishing a rally point placed on the map', async () => {
    await onTheMap();
    fakeSocket.emit.mockClear();
    fireEvent.click(screen.getByTestId('meeting-point-button'));
    fireEvent.click(screen.getByTestId('stub-map-click'));
    const description = await screen.findByRole('textbox', { name: 'Rally point description' });
    expect(fakeSocket.emit.mock.calls.some(c => c[0] === 'publish-waypoint')).toBe(false);
    fireEvent.change(description, { target: { value: 'Meet by the gate at 4 pm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set meeting point', exact: true }));
    expect(fakeSocket.emit).toHaveBeenCalledWith('publish-waypoint', {
      roomCode: code, waypoint: { lat: 12.8231, lng: 80.0442, name: 'RALLY POINT', description: 'Meet by the gate at 4 pm' },
    });
  });

  it('switches Buildings, Group and Map without a draggable panel; AR is above Settings', async () => {
    await onTheMap();
    expect(tabBar().queryByRole('button', { name: /Scan/ })).toBeNull();
    fireEvent.click(tabBar().getByRole('button', { name: 'Buildings' }));
    expect(currentTab()).toBe('Buildings');
    expect(screen.getByTestId('section-page').dataset.section).toBe('buildings');
    expect(screen.queryByTestId('group-panel-header')).toBeNull();
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    expect(screen.getByTestId('section-page').dataset.section).toBe('users');
    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(currentTab()).toBe('Map');
    const controls = within(screen.getByTestId('map-controls')).getAllByRole('button');
    const scan = controls.findIndex(b => b.getAttribute('aria-label') === 'AR Scan');
    expect(scan).toBeGreaterThanOrEqual(0);
    expect(controls[scan+1].getAttribute('aria-label')).toMatch(/Settings/i);
  });
});
