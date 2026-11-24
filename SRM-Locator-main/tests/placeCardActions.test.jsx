// @vitest-environment jsdom
//
// The place card's action row: Navigate, Rally and AR Scan, in place of the old "More Info"
// button, driven through the real App.jsx (fake socket, the Leaflet engine stood in for).
//
//  - Navigate starts your own route with the one navigation there is (the turn-by-turn panel,
//    nav-hud-2), tells nobody, and asks for a fix when there is none.
//  - Rally sets or clears the group's rally point, with the old confirm sheet, a message when
//    you are in no group, and an active state once it is set here.
//  - AR Scan opens AR Scan (behind its camera explainer) aimed at the building.
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

// The latest props App.jsx handed the map engine.
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
vi.mock('google-map-react', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: (props) => {
    leaflet.props = props;
    return null;
  },
}));
// AR Scan itself needs a camera; here it only reports which building it was aimed at.
vi.mock('../src/ARCompass.jsx', () => ({
  default: ({ target }) => <div data-testid="ar-scan" data-lat={target.lat} data-lng={target.lng}>{target.name}</div>,
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
const { SRM_MASTER_DATABASE } = await import('../src/srmDatabase.js');
const { PLACE, MEETING_POINT_CONFIRM, RALLY_CLEAR_CONFIRM } = await import('../src/copy/place.js');
const { CAMERA_EXPLAINER } = await import('../src/copy/permissions.js');
const { NOTICES } = await import('../src/copy/notices.js');
const { NAV_BUILD } = await import('../src/utils/navBuild.js');

const RALLY = { lat: 12.8231, lng: 80.0442, name: 'RALLY POINT' };
const FIX = { coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } };
const building = SRM_MASTER_DATABASE[0];

const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, ...args]) => args);

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

// A building's card, opened the way a person opens it: from the buildings list.
const openCard = async () => {
  fireEvent.click((await screen.findAllByText(building.name))[0]);
  return screen.getByTestId('location-card');
};
const rallyButton = () => within(screen.getByTestId('location-card')).getByTestId('place-rally');
const pageText = () => document.body.textContent;

let alertSpy;
let gpsFix = null;

beforeEach(() => {
  // Each scenario starts in the lobby, without the previous test's remembered group.
  localStorage.removeItem('locus.group');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  leaflet.props = null;
  gpsFix = null;
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  // The walking route asks a routing service; here it falls back to the straight line.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
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
  vi.unstubAllGlobals();
  alertSpy.mockRestore();
  delete navigator.geolocation;
});

describe('the place card', () => {
  it('has Navigate, Rally and AR Scan in one row, and no More Info', async () => {
    render(<App />);
    await joinAsMember();
    const card = await openCard();
    const row = within(card).getByTestId('place-navigate').parentElement;
    expect([...row.children].map((b) => b.textContent)).toEqual([PLACE.navigate, PLACE.rally, PLACE.arScan]);
    expect(within(card).queryByText(/more info/i)).toBeNull();
    expect(within(card).queryByRole('button', { name: /more about this place/i })).toBeNull();
  });

  it('keeps each label on one line, and the buttons at least 48 px tall', async () => {
    render(<App />);
    await joinAsMember();
    const card = await openCard();
    for (const id of ['place-navigate', 'place-rally', 'place-ar-scan']) {
      const button = within(card).getByTestId(id);
      const label = button.querySelector('span');
      expect(parseInt(button.style.height, 10)).toBeGreaterThanOrEqual(48);
      expect(label.className).toMatch(/whitespace-nowrap/);
      expect(label.className).toMatch(/truncate/);
    }
  });

  it('still steps through photos with its arrows and closes with its X', async () => {
    render(<App />);
    await joinAsMember();
    const card = await openCard();
    const next = within(card).queryByRole('button', { name: 'Next photo' });
    if (next) {
      fireEvent.click(next);
      expect(within(card).getByText(/^2\//)).toBeTruthy();
    }
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('location-card')).toBeNull());
  });
});

describe('Navigate on the card', () => {
  it('starts your own route to the building and closes the card', async () => {
    gpsFix = FIX;
    render(<App />);
    await joinAsMember();
    await waitFor(() => expect(leaflet.props.liveLocation).toBeTruthy());

    fireEvent.click(within(await openCard()).getByTestId('place-navigate'));
    expect(await screen.findByTestId('turn-instruction-card')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('location-card')).toBeNull());
    expect(emitted('publish-waypoint')).toEqual([]);
    await waitFor(() => expect(leaflet.props.walkingRoute?.path.at(-1)).toMatchObject({ lat: building.lat, lng: building.lng }));
  });

  it('is the new navigation: the single top panel, marked with its build', async () => {
    gpsFix = FIX;
    render(<App />);
    await joinAsMember();
    await waitFor(() => expect(leaflet.props.liveLocation).toBeTruthy());
    fireEvent.click(within(await openCard()).getByTestId('place-navigate'));

    const panel = await screen.findByTestId('turn-instruction-card');
    expect(panel.getAttribute('data-nav-build')).toBe(NAV_BUILD);
    expect(NAV_BUILD).toBe('nav-hud-2');
    // None of the old navigation's pieces: the bottom trip card or the km/h badge.
    expect(screen.queryByText('km/h')).toBeNull();
  });

  it('without a fix says it is waiting for your location, and starts no route', async () => {
    render(<App />);
    await joinAsMember();
    fireEvent.click(within(await openCard()).getByTestId('place-navigate'));

    expect(pageText()).toContain(NOTICES.navigate.waitingForLocation);
    expect(screen.queryByTestId('turn-instruction-card')).toBeNull();
    expect(screen.getByTestId('location-card')).toBeTruthy();
  });
});

describe('Rally on the card', () => {
  it('asks first, then sets this building as the rally point, and shows it as set', async () => {
    render(<App />);
    await joinAsMember();
    await openCard();
    expect(rallyButton().getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(rallyButton());
    expect(emitted('publish-waypoint')).toEqual([]);
    const dialog = screen.getByRole('dialog', { name: MEETING_POINT_CONFIRM.title(building.name) });
    fireEvent.click(within(dialog).getByRole('button', { name: MEETING_POINT_CONFIRM.confirm }));

    expect(emitted('publish-waypoint')).toEqual([
      [{ roomCode: 'KTR7X9', waypoint: { lat: building.lat, lng: building.lng, name: building.name, description: '' } }],
    ]);
    expect(pageText()).toContain(NOTICES.rally.set(building.name));
    expect(rallyButton().textContent).toBe(PLACE.rallySet);
    expect(rallyButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('Cancel sets nothing', async () => {
    render(<App />);
    await joinAsMember();
    await openCard();
    fireEvent.click(rallyButton());
    fireEvent.click(within(screen.getByRole('dialog', { name: MEETING_POINT_CONFIRM.title(building.name) })).getByRole('button', { name: MEETING_POINT_CONFIRM.cancel }));
    expect(emitted('publish-waypoint')).toEqual([]);
    expect(rallyButton().textContent).toBe(PLACE.rally);
  });

  it('a tap on a rally point already set here offers to clear it, and clearing goes to the server', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', { lat: building.lat, lng: building.lng, name: building.name, setBy: 'u-self' }));
    await openCard();
    expect(rallyButton().textContent).toBe(PLACE.rallySet);

    fireEvent.click(rallyButton());
    expect(emitted('clear-waypoint')).toEqual([]);
    const dialog = screen.getByRole('dialog', { name: RALLY_CLEAR_CONFIRM.title(building.name) });
    fireEvent.click(within(dialog).getByRole('button', { name: RALLY_CLEAR_CONFIRM.confirm }));
    expect(emitted('clear-waypoint')).toEqual([['KTR7X9']]);

    act(() => fakeSocket.receive('remove-waypoint'));
    await waitFor(() => expect(rallyButton().textContent).toBe(PLACE.rally));
  });

  it("tells a member they cannot clear someone else's rally point", async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', { lat: building.lat, lng: building.lng, name: building.name, setBy: 'u-other' }));
    await openCard();
    fireEvent.click(rallyButton());
    expect(screen.queryByRole('dialog', { name: RALLY_CLEAR_CONFIRM.title(building.name) })).toBeNull();
    expect(pageText()).toContain(NOTICES.rally.cannotClear);
    expect(emitted('clear-waypoint')).toEqual([]);
  });

  it("lets the Commander clear anyone's rally point from the card", async () => {
    render(<App />);
    await createAsCommander();
    act(() => fakeSocket.receive('new-waypoint', { lat: building.lat, lng: building.lng, name: building.name, setBy: 'u-other' }));
    await openCard();
    fireEvent.click(rallyButton());
    expect(screen.getByRole('dialog', { name: RALLY_CLEAR_CONFIRM.title(building.name) })).toBeTruthy();
  });

  it('a rally point at another place is not shown as set here', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-self' }));
    await openCard();
    expect(rallyButton().textContent).toBe(PLACE.rally);
  });
});

describe('AR Scan on the card', () => {
  it('opens AR Scan aimed at this building, behind the camera explainer on a first run', async () => {
    render(<App />);
    await joinAsMember();
    fireEvent.click(within(await openCard()).getByTestId('place-ar-scan'));
    const explainer = await screen.findByRole('dialog', { name: /camera/i });
    expect(screen.queryByTestId('ar-scan')).toBeNull();

    fireEvent.click(within(explainer).getByRole('button', { name: CAMERA_EXPLAINER.continue }));
    const scan = await screen.findByTestId('ar-scan');
    expect(scan.textContent).toBe(building.name);
    expect(Number(scan.dataset.lat)).toBe(building.lat);
    expect(Number(scan.dataset.lng)).toBe(building.lng);
  });
});
