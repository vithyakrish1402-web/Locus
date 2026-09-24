// @vitest-environment jsdom
//
// The client half of clearing a Rally Point (the server half is in
// rallyPointClear.e2e.test.js).
//
//  - The clear control (the ✕ on the Rally Point marker) was shown to the Commander only,
//    while any member can drop a Rally Point. A member's own was theirs to live with.
//  - A Rally Point outlived the squad: leaving didn't clear it, so it rode along into the
//    next squad, where nobody's server-side state matched it.
//  - The route panel opened by choosing a destination (which is what published that Rally
//    Point) stayed up, still tracking it, after the Rally Point was cleared.
//  - The Commander's own RALLY POINT button in the squad panel only worked for the admin
//    account: the map tap it waits for was gated on isAdmin, not on being Commander.
//
// Renders the real App.jsx; the Leaflet engine (the one in use without a Maps key) is
// stood in for by the real WaypointMarker, wired the way TacticalLeafletMap wires it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';

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
  };
});

// The latest props App.jsx handed the map engine, so a test can tap the map.
const leaflet = vi.hoisted(() => ({ props: null }));

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
// Children rendered as-is, so the Google engine's own WaypointMarker can be exercised too
// (see the last describe block, which re-imports App with a Maps key set).
vi.mock('google-map-react', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../src/components/TacticalLeafletMap.jsx', async () => {
  const { default: WaypointMarker } = await import('../src/components/WaypointMarker.jsx');
  return {
    default: (props) => {
      leaflet.props = props;
      const wp = props.activeWaypoint;
      if (!wp) return null;
      // As TacticalLeafletMap renders it. (Before this fix it was handed squadRole and
      // decided canClear itself, as `squadRole === 'OWNER'`.)
      const canClear = props.canClearWaypoint ?? props.squadRole === 'OWNER';
      return <WaypointMarker name={wp.name} canClear={canClear} onClear={props.onClearWaypoint} onTrack={() => {}} onClick={() => {}} />;
    },
  };
});
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

const RALLY = { lat: 12.8231, lng: 80.0442, name: 'RALLY POINT' };
const FIX = { coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } };

const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, ...args]) => args);
const clearButton = () => screen.queryByTitle('Clear Rally Point');
const rallyPointOnMap = () => screen.queryByTitle('AR Track Rally Point');

const joinAsMember = async (code = 'KTR7X9') => {
  fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
  fireEvent.change(screen.getByPlaceholderText('E.G. KTR7X9'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /connect to squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: code }));
  await waitFor(() => expect(leaflet.props).not.toBeNull());
};

const createAsCommander = async () => {
  fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
  await waitFor(() => expect(leaflet.props).not.toBeNull());
};

const openSquadTab = () => fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' })[0]);

let alertSpy;
let gpsFix = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  leaflet.props = null;
  gpsFix = null;
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok) => { if (gpsFix) ok(gpsFix); }),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  alertSpy.mockRestore();
  delete navigator.geolocation;
});

describe('the clear control on the Rally Point', () => {
  it('is offered to the member who dropped it, and clears it for the squad', async () => {
    render(<App />);
    await joinAsMember('KTR7X9');
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-self' }));

    fireEvent.click(await screen.findByTitle('Clear Rally Point'));
    expect(emitted('clear-waypoint')).toEqual([['KTR7X9']]);
  });

  it('is not offered to a member on someone else\'s Rally Point', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    await screen.findByTitle('AR Track Rally Point');
    expect(clearButton()).toBeNull();
  });

  it('is offered to the Commander on anyone\'s Rally Point', async () => {
    render(<App />);
    await createAsCommander();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    expect(await screen.findByTitle('Clear Rally Point')).toBeTruthy();
  });
});

describe('a Rally Point leaving the map', () => {
  it('goes when the server says it was cleared', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    await screen.findByTitle('AR Track Rally Point');

    act(() => fakeSocket.receive('remove-waypoint'));
    await waitFor(() => expect(rallyPointOnMap()).toBeNull());
  });

  it('goes with the squad: it does not ride along into the next one', async () => {
    render(<App />);
    await joinAsMember('KTR7X9');
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    await screen.findByTitle('AR Track Rally Point');

    openSquadTab();
    fireEvent.click(screen.getByRole('button', { name: 'DISCONNECT' }));
    await joinAsMember('OTHER1');
    await waitFor(() => expect(rallyPointOnMap()).toBeNull());
  });

  it('closes the route panel that was tracking it', async () => {
    gpsFix = FIX; // choosing a destination routes from the user's own position
    render(<App />);
    await joinAsMember('KTR7X9');
    await waitFor(() => expect(leaflet.props.liveLocation).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: 'SELECT_WAYPOINT' })[0]);
    expect(screen.getByText('ACTIVE_WAYPOINT_TRACKING')).toBeTruthy();
    const [[published]] = emitted('publish-waypoint');
    act(() => fakeSocket.receive('new-waypoint', { ...published.waypoint, setBy: 'u-self' }));

    act(() => fakeSocket.receive('remove-waypoint'));
    await waitFor(() => expect(screen.queryByText('ACTIVE_WAYPOINT_TRACKING')).toBeNull());
  });
});

describe("the Commander's RALLY POINT button", () => {
  it('drops a Rally Point for any Commander, not only the admin account', async () => {
    render(<App />);
    await createAsCommander();
    openSquadTab();

    fireEvent.click(screen.getByRole('button', { name: /RALLY POINT/ }));
    act(() => leaflet.props.onMapClick({ lat: 12.82, lng: 80.04 }));
    expect(emitted('publish-waypoint')).toEqual([
      [{ roomCode: expect.stringMatching(/^[A-Z0-9]{6}$/), waypoint: { lat: 12.82, lng: 80.04, name: 'RALLY POINT' } }],
    ]);
  });
});

describe('the clear control on the Google engine (used whenever a Maps key is configured)', () => {
  it('is offered to the member who dropped the Rally Point there too', async () => {
    // The key is read once, when App.jsx is first evaluated, so load a second copy of it.
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');
    vi.resetModules();
    const { default: GoogleApp } = await import('../src/App.jsx');
    try {
      render(<GoogleApp />);
      fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
      fireEvent.change(screen.getByPlaceholderText('E.G. KTR7X9'), { target: { value: 'KTR7X9' } });
      fireEvent.click(screen.getByRole('button', { name: /connect to squad/i }));
      act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'KTR7X9' }));
      act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-self' }));

      expect(leaflet.props).toBeNull(); // really the Google engine
      fireEvent.click(await screen.findByTitle('Clear Rally Point'));
      expect(emitted('clear-waypoint')).toEqual([['KTR7X9']]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
