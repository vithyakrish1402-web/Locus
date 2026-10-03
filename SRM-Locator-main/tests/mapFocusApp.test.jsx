// @vitest-environment jsdom
//
// The App.jsx side of the map glide: a matrix building tap, and the in-app rally-point
// notice a squadmate gets. The glide itself is tested in mapFocus.test.js, so focusMapOn is
// a spy here. (The real two-phone delivery is still a check for a device.)
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
const focus = vi.hoisted(() => ({ spy: null }));

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
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({ default: () => <div data-testid="map" /> }));
vi.mock('../src/utils/mapFocus.js', async (importOriginal) => {
  const actual = await importOriginal();
  focus.spy = vi.fn(() => true);
  return { ...actual, focusMapOn: focus.spy };
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
const { __resetNotifications } = await import('../src/utils/notify.js');

const RALLY = { lat: 12.8231, lng: 80.0442, name: 'RALLY POINT', setBy: 'u-other' };

const joinAsMember = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
  fireEvent.change(screen.getByPlaceholderText('E.G. KTR7X9'), { target: { value: 'KTR7X9' } });
  fireEvent.click(screen.getByRole('button', { name: /connect to squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'KTR7X9' }));
  await screen.findByTestId('map');
};
const notice = () => screen.queryByText(/designated a rally point/i);

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  focus.spy.mockClear();
  __resetNotifications();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  delete navigator.geolocation;
});

describe("a squadmate's rally-point notice", () => {
  it('glides to the rally point when tapped', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', RALLY));
    fireEvent.click(await screen.findByText(/designated a rally point/i));
    expect(focus.spy).toHaveBeenCalledTimes(1);
    expect(focus.spy.mock.calls[0][0]).toEqual({ lat: RALLY.lat, lng: RALLY.lng, zoom: 19 });
    await waitFor(() => expect(notice()).toBeNull()); // after its exit animation
  });

  it('is not shown to the member who placed it', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY, setBy: 'u-self' }));
    expect(notice()).toBeNull();
  });

  it('is not repeated when the server re-sends the same rally point after a reconnect', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', RALLY));
    fireEvent.click(await screen.findByText(/designated a rally point/i));
    await waitFor(() => expect(notice()).toBeNull());
    act(() => fakeSocket.receive('new-waypoint', { ...RALLY }));
    expect(notice()).toBeNull();
  });

  it('says so, and does not move the map, once the rally point is gone', async () => {
    render(<App />);
    await joinAsMember();
    act(() => fakeSocket.receive('new-waypoint', RALLY));
    const tap = await screen.findByText(/designated a rally point/i);
    act(() => fakeSocket.receive('remove-waypoint'));
    fireEvent.click(tap);
    expect(await screen.findByText(/no longer active/i)).toBeTruthy();
    expect(focus.spy).not.toHaveBeenCalled();
  });
});

describe('a matrix building tap', () => {
  it('glides to the building at zoom 19', async () => {
    render(<App />);
    await joinAsMember();
    const b = SRM_MASTER_DATABASE[0];
    fireEvent.click((await screen.findAllByText(b.name))[0]);
    expect(focus.spy).toHaveBeenCalledTimes(1);
    expect(focus.spy.mock.calls[0][0]).toEqual({ lat: b.lat, lng: b.lng, zoom: 19 });
  });

  it('closes the phone sheet that covers the map', async () => {
    const original = window.matchMedia;
    // A phone-sized, reduced-motion viewport: the sheet is a bottom sheet, and settles at once.
    window.matchMedia = (query) => ({
      matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
    });
    try {
      const { container } = render(<App />);
      await joinAsMember();
      const sheet = () => container.querySelector('.fixed.inset-x-0.bottom-16');
      fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' }).at(-1)); // the bottom bar's: opens the sheet
      fireEvent.click(screen.getAllByRole('button', { name: /MATRIX/ })[0]);
      await waitFor(() => expect(sheet().style.transform).not.toContain('100%'));
      fireEvent.click((await screen.findAllByText(SRM_MASTER_DATABASE[0].name))[0]);
      await waitFor(() => expect(sheet().style.transform).toContain('100%'));
    } finally {
      window.matchMedia = original;
    }
  });

  it("also glides when the row's waypoint button is pressed", async () => {
    render(<App />);
    await joinAsMember();
    await screen.findAllByText(SRM_MASTER_DATABASE[0].name);
    fireEvent.click(screen.getAllByRole('button', { name: 'SELECT_WAYPOINT' })[0]);
    expect(focus.spy).toHaveBeenCalledTimes(1);
    const b = SRM_MASTER_DATABASE[0];
    expect(focus.spy.mock.calls[0][0]).toEqual({ lat: b.lat, lng: b.lng, zoom: 19 });
  });
});
