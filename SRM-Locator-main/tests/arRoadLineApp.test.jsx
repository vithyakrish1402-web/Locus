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
    ? <button title="Find with AR Scan" onClick={() => onArTrack({ lat: activeWaypoint.lat, lng: activeWaypoint.lng, name: activeWaypoint.name })} />
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

// 'realistic' mode's three.js modules, stood in for so it runs without WebGL. The road's
// records every strip it is given.
const roadViews = vi.hoisted(() => []);
vi.mock('../src/utils/arRoadScene.js', () => ({
  createRoadView: () => {
    const view = { setRoad: vi.fn(), setOrientation: vi.fn(), setView: vi.fn(), render: vi.fn(), dispose: vi.fn() };
    roadViews.push(view);
    return view;
  },
}));
vi.mock('../src/utils/arArrowScene.js', () => ({
  createArrowView: () => ({ setRotation: vi.fn(), setView: vi.fn(), render: vi.fn(), dispose: vi.fn() }),
}));

const { default: App } = await import('../src/App.jsx');
const { SRM_MASTER_DATABASE } = await import('../src/srmDatabase.js');
const { SETTINGS } = await import('../src/copy/settings.js');

beforeEach(() => {
  // The camera was allowed before, so AR Scan opens without its explainer (see cameraExplainer.test.jsx).
  try { localStorage.setItem('locus.cameraAllowed', '1'); } catch { /* no storage */ }
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
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => fakeSocket.receive('new-waypoint', RALLY));
  await act(async () => {}); // the route fetch resolves
};
const grantAndFaceNorth = async () => {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
  faceNorth();
};

describe('the AR road line', () => {
  it('is drawn when AR Scan is on the Rally Point', async () => {
    await onTheMapWithRally();
    expect(globalThis.fetch).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    expect(screen.getByTestId('ar-target-pill').textContent).toContain('RALLY_ALPHA');
    expect(roadLine()).toBeTruthy();
    expect(roadLine().querySelector('polygon').getAttribute('points').split(' ').length).toBeGreaterThan(4);
  });

  // Your own destination drives the road line when you have one, otherwise the meeting point
  // (owner's rule, AR Scan batch; it used to follow the meeting point only). The road is
  // drawn only when AR Scan is aimed at where that route leads.
  it('follows your own destination when you have one, with AR Scan aimed at it', async () => {
    const realFetch = globalThis.fetch;
    // A real route only toward the first building; anything else gets no answer.
    const building = SRM_MASTER_DATABASE[0];
    globalThis.fetch = vi.fn(async (url) => (String(url).includes(`${building.lng},${building.lat}?`)
      ? realFetch(url)
      : Promise.reject(new Error('offline'))));
    await onTheMapWithRally();
    fireEvent.click(screen.getByRole('radio', { name: 'Buildings' }));
    fireEvent.click(screen.getByRole('button', { name: `Navigate to ${building.name}` }));
    await act(async () => {});
    expect(screen.getByTestId('route-card')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: `AR Scan to ${building.name}` }));
    await grantAndFaceNorth();
    expect(roadLine()).toBeTruthy();
  });

  it('with your own destination elsewhere, AR Scan on the meeting point draws no road (it would lead elsewhere)', async () => {
    await onTheMapWithRally();
    fireEvent.click(screen.getByRole('radio', { name: 'Buildings' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Navigate to / })[0]);
    await act(async () => {});
    expect(screen.getByTestId('route-card')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    expect(screen.getByTestId('ar-target-pill').textContent).toContain('RALLY_ALPHA');
    expect(roadLine()).toBeNull();
  });

  it('runs up to the Rally Point tag: the tag sits on the road’s far end', async () => {
    await onTheMapWithRally();
    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    // The tag glides to a new spot (the Landmark Anchor Engine's easing); let it land.
    await act(() => new Promise((r) => setTimeout(r, 800)));
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
    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    expect(roadLine()).toBeNull();
  });

  // The readout's walking time follows the same rule (AR Scan batch, piece 8): "about N min
  // on foot" only along a real route; without one, distance and direction only.
  it('the readout gives the walk only along a real route', async () => {
    await onTheMapWithRally();
    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    expect(screen.getByTestId('ar-readout').textContent).toMatch(/about \d+ min on foot/);
  });

  it('no walk in the readout before a real route arrives', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})); // still fetching
    await onTheMapWithRally();
    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    expect(screen.getByTestId('ar-readout-distance')).toBeTruthy();
    expect(screen.getByTestId('ar-readout').textContent).not.toMatch(/min on foot/);
  });

  it('is not drawn when AR Scan is on a squad member, even one on the Rally Point', async () => {
    await onTheMapWithRally();
    act(() => fakeSocket.receive('users-update', {
      'sock-1': { uid: 'u-bravo', name: 'Bravo', roomCode: code, lat: RALLY.lat, lng: RALLY.lng, battery: 50, lastSeen: 1 },
    }));
    fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
    await grantAndFaceNorth();
    expect(screen.getByTestId('ar-target-pill').textContent).toContain('Bravo');
    expect(roadLine()).toBeNull();
  });

  it('is not drawn on the SRM_HQ default', async () => {
    await onTheMapWithRally();
    fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
    await grantAndFaceNorth();
    expect(screen.getByTestId('ar-target-pill').textContent).toContain('SRM_HQ');
    expect(roadLine()).toBeNull();
  });
});

describe('the AR road line in REALISTIC mode', () => {
  const roadGl = () => screen.queryByTestId('ar-road-gl');
  const chooseRealistic = () => {
    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: SETTINGS.arQuality })).getByRole('radio', { name: SETTINGS.arQualityOptions.realistic }));
  };
  beforeEach(() => {
    roadViews.length = 0;
  });
  const settle = () => act(async () => {});

  it('is drawn in three.js when AR Scan is on the Rally Point', async () => {
    await onTheMapWithRally();
    chooseRealistic();
    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    await settle();
    expect(roadGl()).toBeTruthy();
    expect(roadLine()).toBeNull();
    expect(roadViews).toHaveLength(1);
    expect(roadViews[0].setRoad.mock.calls.at(-1)[0].positions.length).toBeGreaterThan(6);
  });

  it('is not drawn before a real route arrives', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}));
    await onTheMapWithRally();
    chooseRealistic();
    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    await settle();
    expect(roadGl()).toBeNull();
    expect(roadLine()).toBeNull();
    expect(roadViews).toHaveLength(0);
  });

  it('is not drawn when AR Scan is on a squad member, even one on the Rally Point', async () => {
    await onTheMapWithRally();
    act(() => fakeSocket.receive('users-update', {
      'sock-1': { uid: 'u-bravo', name: 'Bravo', roomCode: code, lat: RALLY.lat, lng: RALLY.lng, battery: 50, lastSeen: 1 },
    }));
    chooseRealistic();
    fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
    await grantAndFaceNorth();
    await settle();
    expect(screen.getByTestId('ar-target-pill').textContent).toContain('Bravo');
    expect(roadGl()).toBeNull();
    expect(roadLine()).toBeNull();
    expect(roadViews).toHaveLength(0);
  });

  it('is not drawn on the SRM_HQ default', async () => {
    await onTheMapWithRally();
    chooseRealistic();
    fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
    await grantAndFaceNorth();
    await settle();
    expect(screen.getByTestId('ar-target-pill').textContent).toContain('SRM_HQ');
    expect(roadGl()).toBeNull();
    expect(roadLine()).toBeNull();
    expect(roadViews).toHaveLength(0);
  });
});

// Stage 6: the road line's own override, through the real App and a real route.
describe('the AR road line override, with the main dial on REALISTIC', () => {
  const roadGl = () => screen.queryByTestId('ar-road-gl');
  const openWith = async (roadLine) => {
    await onTheMapWithRally();
    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: SETTINGS.arQuality })).getByRole('radio', { name: SETTINGS.arQualityOptions.realistic }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: SETTINGS.arPartNames.roadLine })).getByRole('radio', { name: SETTINGS.arPartOptions[roadLine.toLowerCase()] }));
    fireEvent.click(screen.getByTitle('Find with AR Scan'));
    await grantAndFaceNorth();
    await act(async () => {});
  };
  beforeEach(() => {
    roadViews.length = 0;
  });

  it('OFF: no road at all, while the arrow stays 3D', async () => {
    await openWith('OFF');
    expect(roadGl()).toBeNull();
    expect(roadLine()).toBeNull();
    expect(roadViews).toHaveLength(0);
    expect(screen.getByTestId('ar-arrow-ring').dataset.fidelity).toBe('realistic');
  });

  it('EFFICIENT: the light ribbon instead of the 3D road', async () => {
    await openWith('EFFICIENT');
    expect(roadLine()).toBeTruthy();
    expect(roadGl()).toBeNull();
    expect(roadViews).toHaveLength(0);
  });

  it('AUTO: follows the dial, the 3D road', async () => {
    await openWith('AUTO');
    expect(roadGl()).toBeTruthy();
    expect(roadLine()).toBeNull();
  });
});
