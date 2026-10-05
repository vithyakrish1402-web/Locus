// @vitest-environment jsdom
//
// The location explainer and "Location is off" (redesign Map batch, piece 8), through the real
// App.jsx: before Continue nothing asks for or shares a location; Not now leaves it off with a
// card to turn it on; once a real fix has arrived (or the phone says location is allowed) the
// explainer never shows again.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

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
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({ default: () => null }));
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
const { LOCATION_EXPLAINER } = await import('../src/copy/permissions.js');
const { MAP_BANNERS } = await import('../src/copy/map.js');
const { LOCATION_ALLOWED_KEY } = await import('../src/utils/locationPermission.js');

const FIX = { coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } };
const explainer = () => screen.queryByRole('dialog', { name: LOCATION_EXPLAINER.title });
const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event);

const onTheMap = async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
  await act(async () => {});
};

let geo;
beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  try { localStorage.removeItem(LOCATION_ALLOWED_KEY); } catch { /* no storage */ }
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  geo = {
    getCurrentPosition: vi.fn((ok) => ok(FIX)),
    watchPosition: vi.fn(() => 1),
    clearWatch: vi.fn(),
  };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete navigator.geolocation;
  delete navigator.permissions;
});

describe('the location explainer', () => {
  it('shows on the map the first time, and nothing asks for or shares a location before Continue', async () => {
    await onTheMap();
    expect(explainer()).toBeTruthy();
    expect(explainer().textContent).toContain(LOCATION_EXPLAINER.body);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(emitted('update-location')).toEqual([]);
    expect(screen.queryByTestId('finding-location')).toBeNull();
  });

  it('Continue asks for location, and shares it as before', async () => {
    await onTheMap();
    fireEvent.click(within(explainer()).getByRole('button', { name: LOCATION_EXPLAINER.continue }));
    await act(async () => {});
    expect(geo.getCurrentPosition).toHaveBeenCalled();
    expect(geo.watchPosition).toHaveBeenCalled();
    expect(emitted('update-location').length).toBeGreaterThan(0);
  });

  it('a real fix is remembered, so it never shows again', async () => {
    await onTheMap();
    fireEvent.click(within(explainer()).getByRole('button', { name: LOCATION_EXPLAINER.continue }));
    await act(async () => {});
    expect(localStorage.getItem(LOCATION_ALLOWED_KEY)).toBe('1');
    cleanup();
    await onTheMap();
    expect(explainer()).toBeNull();
    expect(geo.getCurrentPosition).toHaveBeenCalled();
  });

  it('a refused location is not remembered as allowed', async () => {
    geo.getCurrentPosition = vi.fn((_ok, fail) => fail({ code: 1, message: 'denied' }));
    await onTheMap();
    fireEvent.click(within(explainer()).getByRole('button', { name: LOCATION_EXPLAINER.continue }));
    await act(async () => {});
    expect(localStorage.getItem(LOCATION_ALLOWED_KEY)).toBeNull();
    expect(screen.getByTestId('location-problem').dataset.kind).toBe('denied');
  });

  it("doesn't show when the phone says location is already allowed", async () => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn(async () => ({ state: 'granted' })) } });
    await onTheMap();
    await act(async () => {});
    expect(explainer()).toBeNull();
    expect(geo.getCurrentPosition).toHaveBeenCalled();
  });
});

describe('Not now, and "Location is off"', () => {
  it('Not now leaves location off: nothing asked or shared, and the card says so', async () => {
    await onTheMap();
    fireEvent.click(within(explainer()).getByRole('button', { name: LOCATION_EXPLAINER.notNow }));
    await waitFor(() => expect(explainer()).toBeNull());
    const card = screen.getByTestId('location-problem');
    expect(card.textContent).toContain(MAP_BANNERS.locationOff.title);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(emitted('update-location')).toEqual([]);
    expect(screen.queryByTestId('sharing-chip')).toBeNull();
  });

  it('Turn on location asks for it and starts sharing', async () => {
    await onTheMap();
    fireEvent.click(within(explainer()).getByRole('button', { name: LOCATION_EXPLAINER.notNow }));
    fireEvent.click(within(screen.getByTestId('location-problem')).getByRole('button', { name: MAP_BANNERS.turnOn }));
    await act(async () => {});
    expect(geo.getCurrentPosition).toHaveBeenCalled();
    expect(emitted('update-location').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('location-problem')).toBeNull();
  });

  it('after a refusal, Turn on location asks Android again', async () => {
    geo.getCurrentPosition = vi.fn((_ok, fail) => fail({ code: 1, message: 'denied' }));
    localStorage.setItem(LOCATION_ALLOWED_KEY, '1');
    await onTheMap();
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    geo.getCurrentPosition = vi.fn((ok) => ok(FIX));
    fireEvent.click(within(screen.getByTestId('location-problem')).getByRole('button', { name: MAP_BANNERS.turnOn }));
    await act(async () => {});
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('location-problem')).toBeNull());
  });

  it('no fix (not a refusal) has no Turn on button: the phone keeps trying', async () => {
    geo.getCurrentPosition = vi.fn((_ok, fail) => fail({ code: 3, message: 'timeout' }));
    localStorage.setItem(LOCATION_ALLOWED_KEY, '1');
    await onTheMap();
    expect(within(screen.getByTestId('location-problem')).queryByRole('button', { name: MAP_BANNERS.turnOn })).toBeNull();
  });
});
