// @vitest-environment jsdom
//
// GUI glitches found while auditing the phone layout, each pinned by a test:
//  - The bottom bar's GRID tab toggled satellite on every tap, so going back to the map
//    from SQUAD flipped the map style. It only navigates now; the globe button toggles.
//  - The targeting banner was fixed at nearly the height of the banner stack, so it landed
//    on top of the location banner and hid it. It is part of the stack now.
//  - Squad events ended in window.alert(), which froze the whole app (map, sockets, an
//    incoming SOS) until dismissed. They post to the comms feed now.
//  - The roster: nearest squadmate first, with the direction finder card.
//
// Renders the real App.jsx; only the socket, Firebase, native plugins, maps and the update
// hooks are stubbed.
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
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({ default: () => null }));
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
const { __resetNotifications } = await import('../src/utils/notify.js');

let geolocationError = null;

beforeEach(() => {
  __resetNotifications(); // the feed is module-level: start each test empty
  geolocationError = null;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((_ok, fail) => { if (geolocationError) fail(geolocationError); }),
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

// Signed in -> lobby -> INITIALIZE -> the map.
const onTheMap = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
};
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const currentTab = () => tabBar().getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.textContent;
// Comms-feed notices' text (other role="alert" elements, like the lobby notice, excluded).
const notices = () =>
  screen.queryAllByRole('alert').filter((el) => el.closest('[aria-live="polite"]')).map((el) => el.textContent).join(' || ');
const mapStyle = () => (screen.queryByText('ORBITAL RECON') ? 'satellite' : 'grid');

describe('the bottom bar', () => {
  it('GRID takes you back to the map without flipping it to satellite', () => {
    onTheMap();
    expect(mapStyle()).toBe('grid');
    fireEvent.click(tabBar().getByRole('button', { name: /SQUAD/ }));
    expect(currentTab()).toBe('SQUAD');

    fireEvent.click(tabBar().getByRole('button', { name: /GRID/ }));
    expect(currentTab()).toBe('GRID');
    expect(mapStyle()).toBe('grid');

    fireEvent.click(tabBar().getByRole('button', { name: /GRID/ })); // again, while on it
    expect(mapStyle()).toBe('grid');
  });

  it('leaves satellite to the globe button, and says so on the tab', () => {
    onTheMap();
    fireEvent.click(screen.getByTitle('Switch to Satellite Recon'));
    expect(mapStyle()).toBe('satellite');
    expect(tabBar().getByRole('button', { name: /ORBITAL/ })).toBeTruthy();

    fireEvent.click(tabBar().getByRole('button', { name: /SQUAD/ }));
    fireEvent.click(tabBar().getByRole('button', { name: /ORBITAL/ }));
    expect(mapStyle()).toBe('satellite'); // still what the user chose
  });

  it('marks exactly one tab as the current one, following the screen', () => {
    onTheMap();
    const marked = () => tabBar().getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page');
    expect(marked().map((b) => b.textContent)).toEqual(['GRID']);
    fireEvent.click(tabBar().getByRole('button', { name: /SQUAD/ }));
    expect(marked().map((b) => b.textContent)).toEqual(['SQUAD']);
  });
});

describe('the banner stack', () => {
  it('stacks the targeting banner with the location banner instead of over it', () => {
    geolocationError = { code: 1, message: 'User denied Geolocation' };
    onTheMap();
    fireEvent.click(screen.getByTitle('Deploy Rally Point'));

    const targeting = screen.getByText('TARGETING MODE ACTIVE');
    const location = screen.getByText(/LOCATION ACCESS DENIED/);
    const stackOf = (el) => el.closest('.flex-col.gap-2');
    expect(stackOf(targeting)).toBeTruthy();
    expect(stackOf(targeting)).toBe(stackOf(location));
    // And targeting comes first, above the location banner.
    expect(targeting.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('squad events use the comms feed, never alert()', () => {
  it('being removed from the squad posts a notice and returns to the lobby', () => {
    onTheMap();
    act(() => fakeSocket.receive('exiled', { reason: 'blocked' }));
    expect(window.alert).not.toHaveBeenCalled();
    expect(notices()).toMatch(/SYS_BANNED.*blocked you/);
    expect(screen.getByText('SECURE_CHANNEL')).toBeTruthy();
  });

  it('a vote-out says so too', () => {
    onTheMap();
    act(() => fakeSocket.receive('exiled', {}));
    expect(window.alert).not.toHaveBeenCalled();
    expect(notices()).toMatch(/SYS_MUTINY/);
  });

  it('a denied join request posts a notice', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
    fireEvent.change(screen.getByPlaceholderText('E.G. KTR7X9'), { target: { value: 'KTR7X9' } });
    fireEvent.click(screen.getByRole('button', { name: /connect to squad/i }));
    act(() => fakeSocket.receive('access-denied', { roomCode: 'KTR7X9' }));
    expect(window.alert).not.toHaveBeenCalled();
    expect(notices()).toMatch(/SYS_REJECTED/);
  });
});

describe('the squad roster', () => {
  it('lists the nearest squadmate first, each with a direction', () => {
    const here = { lat: 12.8249, lng: 80.0452 };
    navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: here.lat, longitude: here.lng, speed: 0 } });
    render(<App />);
    const code = document.querySelector('.sr-only').textContent; // the generated squad code
    fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
    act(() => fakeSocket.receive('users-update', {
      far: { uid: 'u-far', name: 'Faraway', roomCode: code, lat: 12.8400, lng: 80.0600, battery: 50, lastSeen: 1 },
      near: { uid: 'u-near', name: 'Nearby', roomCode: code, lat: 12.8252, lng: 80.0455, battery: 50, lastSeen: 1 },
    }));
    fireEvent.click(tabBar().getByRole('button', { name: /SQUAD/ }));
    const names = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(names.indexOf('Nearby')).toBeGreaterThan(-1);
    expect(names.indexOf('Nearby')).toBeLessThan(names.indexOf('Faraway'));
    expect(screen.getAllByText(/^BEARING (N|NE|E|SE|S|SW|W|NW)$/).length).toBe(2);
  });
});
