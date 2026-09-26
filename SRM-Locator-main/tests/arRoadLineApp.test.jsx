// @vitest-environment jsdom
//
// The AR road line, wired through the real App.jsx: drawn when AR Scan is opened on the
// squad's Rally Point (its AR TRACK button) once a real walking route has arrived, and
// never when AR Scan is on a squad member or the SRM_HQ default.
//
// Same harness as tabBarAndBanners.test.jsx, except the Leaflet map stand-in renders the
// Rally Point's AR TRACK button, wired as TacticalLeafletMap wires it, and fetch answers
// as the OSRM routing service.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';

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
    emit: () => {},
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
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: ({ activeWaypoint, onArTrack }) => (activeWaypoint
    ? <button title="AR Track Rally Point" onClick={() => onArTrack({ lat: activeWaypoint.lat, lng: activeWaypoint.lng, name: activeWaypoint.name })} />
    : null),
}));
vi.mock('../src/hooks/useLiveUpdate.js', () => ({
  useLiveUpdate: () => ({ status: 'idle', supported: false, visible: false, applyNow: vi.fn(), dismiss: vi.fn() }),
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

beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn(() => {}),
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

const HERE = { lat: 12.8230, lng: 80.0440 };
const north = (m, east = 0) => ({ lat: HERE.lat + m / 111320, lng: HERE.lng + east / (111320 * Math.cos((HERE.lat * Math.PI) / 180)) });
const RALLY = { ...north(120), name: 'RALLY_ALPHA' };
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const roadLine = () => screen.queryByTestId('ar-road-line');

// The OSRM answer: north 60 m, a jog east, then on to the Rally Point.
const ROUTE = [HERE, north(60), north(60, 5), { lat: RALLY.lat, lng: RALLY.lng }];
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ code: 'Ok', routes: [{ distance: 130, geometry: { coordinates: ROUTE.map((p) => [p.lng, p.lat]) } }] }),
  }));
});

const faceNorth = () => {
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha: 0 });
  act(() => window.dispatchEvent(event));
};

let code;
const onTheMapWithRally = async () => {
  navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, speed: 0 } });
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => fakeSocket.receive('new-waypoint', RALLY));
  await act(async () => {}); // the route fetch resolves
};
const grantAndFaceNorth = async () => {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  faceNorth();
};

describe('the AR road line', () => {
  it('is drawn when AR Scan is on the Rally Point', async () => {
    await onTheMapWithRally();
    expect(globalThis.fetch).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('AR Track Rally Point'));
    await grantAndFaceNorth();
    expect(screen.getByText('RALLY_ALPHA', { selector: 'h2' })).toBeTruthy();
    expect(roadLine()).toBeTruthy();
    expect(roadLine().querySelector('polygon').getAttribute('points').split(' ').length).toBeGreaterThan(4);
  });

  it('runs up to the Rally Point tag: the tag sits on the road’s far end', async () => {
    await onTheMapWithRally();
    fireEvent.click(screen.getByTitle('AR Track Rally Point'));
    await grantAndFaceNorth();
    // The route (130 m) ends at the Rally Point, so the ribbon's far end is where it is.
    // The outline runs up the left edge, then back down the right: its far end is the
    // middle pair of points.
    const pts = roadLine().querySelector('polygon').getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
    const n = pts.length / 2;
    const farEnd = { x: (pts[n - 1][0] + pts[n][0]) / 2, y: (pts[n - 1][1] + pts[n][1]) / 2 };
    const tag = screen.getAllByTestId('ar-tag').find((t) => t.dataset.variant === 'target');
    expect((parseFloat(tag.style.top) / 100) * window.innerHeight).toBeCloseTo(farEnd.y, 0);
    expect((parseFloat(tag.style.left) / 100) * window.innerWidth).toBeCloseTo(farEnd.x, 0);
  });

  it('is not drawn before a real route arrives', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})); // still fetching
    await onTheMapWithRally();
    fireEvent.click(screen.getByTitle('AR Track Rally Point'));
    await grantAndFaceNorth();
    expect(roadLine()).toBeNull();
  });

  it('is not drawn when AR Scan is on a squad member, even one on the Rally Point', async () => {
    await onTheMapWithRally();
    act(() => fakeSocket.receive('users-update', {
      'sock-1': { uid: 'u-bravo', name: 'Bravo', roomCode: code, lat: RALLY.lat, lng: RALLY.lng, battery: 50, lastSeen: 1 },
    }));
    fireEvent.click(tabBar().getByRole('button', { name: /SCAN/ }));
    await grantAndFaceNorth();
    expect(screen.getByText('Bravo', { selector: 'h2' })).toBeTruthy();
    expect(roadLine()).toBeNull();
  });

  it('is not drawn on the SRM_HQ default', async () => {
    await onTheMapWithRally();
    fireEvent.click(tabBar().getByRole('button', { name: /SCAN/ }));
    await grantAndFaceNorth();
    expect(screen.getByText('SRM_HQ', { selector: 'h2' })).toBeTruthy();
    expect(roadLine()).toBeNull();
  });
});
