// @vitest-environment jsdom
//
// The place card's "More about this place", driven through the real App.jsx: it must open
// to something for every building, never a blank, an error or "undefined".
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
const { BUILDING_INFO_LABEL, BUILDING_INFO_EMPTY_TEXT } = await import('../src/utils/buildingInfo.js');
const { PLACE } = await import('../src/copy/place.js');

const joinAsMember = async () => {
  fireEvent.click(screen.getByRole('radio', { name: 'Join a group' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: 'KTR7X9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'KTR7X9' }));
  await screen.findByTestId('map');
};

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


const openCard = async (building) => {
  fireEvent.click((await screen.findAllByText(building.name))[0]);
  return screen.getByTestId('location-card');
};
const openInfo = (card) => {
  fireEvent.click(within(card).getByRole('button', { name: BUILDING_INFO_LABEL }));
  return screen.getByTestId('building-info');
};
const byName = (name) => SRM_MASTER_DATABASE.find((b) => b.name === name);
// Every real building now has details, so a test fixture stands in for one that has none.
const NO_INFO = 'TEST BUILDING (NO INFO)';
SRM_MASTER_DATABASE.push({ id: 9001, name: NO_INFO, category: 'RESIDENTIAL', lat: 12.8215, lng: 80.0435 });

describe('the building card', () => {
  it('has no QUERY_DATA option, only Building Info', async () => {
    render(<App />);
    await joinAsMember();
    const card = await openCard(SRM_MASTER_DATABASE[0]);
    expect(within(card).queryByText(/query_data|fetching|tactical intel/i)).toBeNull();
    expect(within(card).getByRole('button', { name: BUILDING_INFO_LABEL })).toBeTruthy();
  });

  it('opens Building Info to something useful, not blank, for a full, partial and empty building', async () => {
    render(<App />);
    await joinAsMember();
    for (const name of ['TECH PARK', 'SRM DENTAL COLLEGE', NO_INFO]) {
      const card = await openCard(byName(name));
      const info = openInfo(card);
      expect(info.textContent.trim().length, name).toBeGreaterThan(0);
      expect(info.textContent, name).not.toMatch(/undefined|null|NaN/);
      // Navigate and AR Scan stay on the card; Show on map and Show less sit under them.
      expect(within(card).getByRole('button', { name: PLACE.navigate })).toBeTruthy();
      expect(within(card).getByRole('button', { name: PLACE.showOnMap })).toBeTruthy();
      expect(within(card).getByRole('button', { name: PLACE.less })).toBeTruthy();
      fireEvent.click(within(card).getByRole('button', { name: PLACE.close }));
    }
  });

  it('shows the details a building has', async () => {
    render(<App />);
    await joinAsMember();
    const info = openInfo(await openCard(byName('TECH PARK')));
    expect(info.textContent).toContain('CSE, IT');
    expect(info.textContent).toContain('15');
    expect(info.textContent).not.toContain(BUILDING_INFO_EMPTY_TEXT);
  });

  it('falls back to the friendly line when a building has none', async () => {
    render(<App />);
    await joinAsMember();
    const info = openInfo(await openCard(byName(NO_INFO)));
    expect(info.textContent).toContain(BUILDING_INFO_EMPTY_TEXT);
  });

  it('Show on map glides to the building', async () => {
    render(<App />);
    await joinAsMember();
    const b = byName('TECH PARK');
    const card = await openCard(b);
    openInfo(card);
    focus.spy.mockClear();
    fireEvent.click(within(card).getByRole('button', { name: PLACE.showOnMap }));
    expect(focus.spy).toHaveBeenCalledTimes(1);
    expect(focus.spy.mock.calls[0][0]).toEqual({ lat: b.lat, lng: b.lng, zoom: 19 });
  });

  // "Take me there" (the old Building Info panel's) did exactly what Navigate does: both
  // called handleWaypointSelect with the same place. So it went, and Navigate stays.
  it('has no "Take me there": Navigate does the same, closing the card', async () => {
    render(<App />);
    await joinAsMember();
    const card = await openCard(byName('TECH PARK'));
    openInfo(card);
    expect(within(card).queryByRole('button', { name: /take me there/i })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: PLACE.navigate }));
    await waitFor(() => expect(screen.queryByTestId('location-card')).toBeNull());
  });

  it('opens "More about this place" in place, and Show less closes it', async () => {
    render(<App />);
    await joinAsMember();
    const card = await openCard(byName('TECH PARK'));
    const more = within(card).getByRole('button', { name: PLACE.more });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    openInfo(card);
    fireEvent.click(within(card).getByRole('button', { name: PLACE.less }));
    expect(screen.queryByTestId('building-info')).toBeNull();
  });

  it('shows the category and the name, without the old tactical labels', async () => {
    render(<App />);
    await joinAsMember();
    const card = await openCard(byName('TECH PARK'));
    expect(within(card).getByText('Academic')).toBeTruthy();
    expect(card.textContent).not.toMatch(/SYS_NODE|AR_TRACK|WAYPOINT|SET_DESTINATION/);
  });

  it('closes Building Info when another building is picked', async () => {
    render(<App />);
    await joinAsMember();
    openInfo(await openCard(byName('TECH PARK')));
    await openCard(byName('MBA BLOCK'));
    expect(screen.queryByTestId('building-info')).toBeNull();
  });
});
