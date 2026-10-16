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
import { render, screen, act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

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
const { SRM_MASTER_DATABASE } = await import('../src/srmDatabase.js');
const { PLACE, MEETING_POINT_CONFIRM, ROUTE } = await import('../src/copy/place.js');

const RALLY = { lat: 12.8231, lng: 80.0442, name: 'RALLY POINT' };
const FIX = { coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } };

const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, ...args]) => args);
const clearButton = () => screen.queryByTitle('Remove meeting point');
const rallyPointOnMap = () => screen.queryByTitle('Find with AR Scan');

const joinAsMember = async (code = 'KTR7X9') => {
  fireEvent.click(screen.getByRole('radio', { name: 'Join a group' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: code }));
  await waitFor(() => expect(leaflet.props).not.toBeNull());
};

const createAsCommander = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  await waitFor(() => expect(leaflet.props).not.toBeNull());
};

const openSquadTab = () => fireEvent.click(screen.getByRole('radio', { name: 'Members' }));

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

    fireEvent.click(await screen.findByTitle('Remove meeting point'));
    expect(emitted('clear-waypoint')).toEqual([['KTR7X9']]);
  });

  it('is not offered to a member on someone else\'s Rally Point', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    await screen.findByTitle('Find with AR Scan');
    expect(clearButton()).toBeNull();
  });

  it('is offered to the Commander on anyone\'s Rally Point', async () => {
    render(<App />);
    await createAsCommander();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    expect(await screen.findByTitle('Remove meeting point')).toBeTruthy();
  });
});

describe('a Rally Point leaving the map', () => {
  it('goes when the server says it was cleared', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    await screen.findByTitle('Find with AR Scan');

    act(() => fakeSocket.receive('remove-waypoint'));
    await waitFor(() => expect(rallyPointOnMap()).toBeNull());
  });

  it('goes with the squad: it does not ride along into the next one', async () => {
    render(<App />);
    await joinAsMember('KTR7X9');
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    await screen.findByTitle('Find with AR Scan');

    openSquadTab();
    fireEvent.click(screen.getByTestId('leave-group'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Leave the group?' })).getByRole('button', { name: 'Leave group' }));
    await joinAsMember('OTHER1');
    await waitFor(() => expect(rallyPointOnMap()).toBeNull());
  });

  it("doesn't end your own route: Navigate no longer sets it, so the two are separate", async () => {
    gpsFix = FIX;
    render(<App />);
    await joinAsMember('KTR7X9');
    await waitFor(() => expect(leaflet.props.liveLocation).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: /^Navigate to / })[0]);
    expect(screen.getByTestId('turn-instruction-card')).toBeTruthy();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    act(() => fakeSocket.receive('remove-waypoint'));
    expect(screen.getByTestId('turn-instruction-card')).toBeTruthy();
  });
});

// Navigate starts your own route only. It used to set the group's meeting point as well
// (8602d13); the meeting point is now set only by "Set as meeting point", after a
// confirmation, and removed only by Remove on its marker or the Group Lead's clear.
describe('Navigate and the meeting point', () => {
  const building = SRM_MASTER_DATABASE[0];
  const openCard = async () => {
    fireEvent.click((await screen.findAllByText(building.name))[0]);
    return screen.getByTestId('location-card');
  };
  // Jose's navigation card draws the End route button in two layouts; either one ends the route.
  const endRoute = () => screen.getAllByRole('button', { name: ROUTE.end })[0];

  beforeEach(() => {
    // The walking route asks a routing service; here it falls back to the straight line.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("the card's Navigate starts your own route and tells nobody", async () => {
    gpsFix = FIX;
    render(<App />);
    await joinAsMember();
    await waitFor(() => expect(leaflet.props.liveLocation).toBeTruthy());

    fireEvent.click(within(await openCard()).getByRole('button', { name: PLACE.navigate }));
    expect(screen.getByTestId('turn-instruction-card')).toBeTruthy();
    expect(emitted('publish-waypoint')).toEqual([]);
    expect(leaflet.props.activeWaypoint).toBeNull();
  });

  it("the buildings list's Navigate is your own route too", async () => {
    gpsFix = FIX;
    render(<App />);
    await joinAsMember();
    await waitFor(() => expect(leaflet.props.liveLocation).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: /^Navigate to / })[0]);
    expect(screen.getByTestId('turn-instruction-card')).toBeTruthy();
    expect(emitted('publish-waypoint')).toEqual([]);
  });

  it('draws the walking line to your own destination, with the same route the meeting point uses', async () => {
    gpsFix = FIX;
    render(<App />);
    await joinAsMember();
    await waitFor(() => expect(leaflet.props.liveLocation).toBeTruthy());

    fireEvent.click(within(await openCard()).getByRole('button', { name: PLACE.navigate }));
    await waitFor(() => expect(leaflet.props.walkingRoute?.path.at(-1)).toMatchObject({ lat: building.lat, lng: building.lng }));
  });

  // Changed for Jose's navigation (09086a7): without a fix, Navigate no longer waits for a second
  // choice. It starts turn-by-turn at once from the campus centre, and the place list is hidden
  // while it runs. (It used to be two steps: choose where from, then where to.)
  it("without a fix, Navigate still starts a route at once (from the campus centre)", async () => {
    render(<App />);
    await joinAsMember();
    fireEvent.click(within(await openCard()).getByRole('button', { name: PLACE.navigate }));
    expect(screen.getByTestId('turn-instruction-card')).toBeTruthy();
    expect(emitted('publish-waypoint')).toEqual([]);
  });

  it('"Set as meeting point" asks first, then sets it as before', async () => {
    render(<App />);
    await joinAsMember();
    fireEvent.click(within(await openCard()).getByRole('button', { name: PLACE.setMeetingPoint }));

    const dialog = screen.getByRole('dialog', { name: MEETING_POINT_CONFIRM.title(building.name) });
    expect(emitted('publish-waypoint')).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: MEETING_POINT_CONFIRM.confirm }));
    expect(emitted('publish-waypoint')).toEqual([
      [{ roomCode: 'KTR7X9', waypoint: { lat: building.lat, lng: building.lng, name: building.name } }],
    ]);
  });

  it('Cancel sets nothing', async () => {
    render(<App />);
    await joinAsMember();
    fireEvent.click(within(await openCard()).getByRole('button', { name: PLACE.setMeetingPoint }));
    fireEvent.click(within(screen.getByRole('dialog', { name: MEETING_POINT_CONFIRM.title(building.name) })).getByRole('button', { name: MEETING_POINT_CONFIRM.cancel }));
    expect(emitted('publish-waypoint')).toEqual([]);
  });

  it("End route ends only your route, even for the Group Lead with a meeting point up", async () => {
    gpsFix = FIX;
    render(<App />);
    await createAsCommander();
    await waitFor(() => expect(leaflet.props.liveLocation).toBeTruthy());
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-self' }));

    fireEvent.click(within(await openCard()).getByRole('button', { name: PLACE.navigate }));
    fireEvent.click(endRoute());
    await waitFor(() => expect(screen.queryByTestId('turn-instruction-card')).toBeNull());
    expect(emitted('clear-waypoint')).toEqual([]);
    expect(leaflet.props.activeWaypoint).toMatchObject({ lat: RALLY.lat, lng: RALLY.lng });
  });

  it("the Group Lead's Remove meeting point in the group panel still clears it", async () => {
    render(<App />);
    await createAsCommander();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-other' }));
    openSquadTab();
    fireEvent.click(within(screen.getByTestId('lead-tools')).getByRole('button', { name: 'Remove meeting point' }));
    expect(emitted('clear-waypoint')).toHaveLength(1);
  });
});

describe("the Group Lead's Meeting point in the group panel", () => {
  it('drops a Rally Point for any Commander, not only the admin account', async () => {
    render(<App />);
    await createAsCommander();
    openSquadTab();

    fireEvent.click(within(screen.getByTestId('lead-tools')).getByRole('button', { name: 'Meeting point' }));
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
      fireEvent.click(screen.getByRole('radio', { name: 'Join a group' }));
      fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: 'KTR7X9' } });
      fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
      act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'KTR7X9' }));
      act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-self' }));

      expect(leaflet.props).toBeNull(); // really the Google engine
      fireEvent.click(await screen.findByTitle('Remove meeting point'));
      expect(emitted('clear-waypoint')).toEqual([['KTR7X9']]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
