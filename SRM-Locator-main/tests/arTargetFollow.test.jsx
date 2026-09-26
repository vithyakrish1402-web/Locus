// @vitest-environment jsdom
//
// AR Scan aimed at a squad member follows them as they move. It used to keep the spot
// they stood on when SCAN was tapped, so the arrow pointed at where they had been.
//
// Renders the real App.jsx; only the socket, Firebase, native plugins, maps and the update
// hooks are stubbed (same harness as tabBarAndBanners.test.jsx).
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
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const proximity = () => Number(screen.getByText('PROXIMITY').nextSibling.textContent.replace('M', ''));

let code;
const member = (lat, lng, extra = {}) => ({ uid: 'u-bravo', name: 'Bravo', roomCode: code, lat, lng, battery: 50, lastSeen: 1, ...extra });
const roster = (entries) => act(() => fakeSocket.receive('users-update', entries));

// On the map, with Bravo ~110 m north, then SCAN (which aims at Bravo) and GRANT_ACCESS.
const scanAtBravo = async () => {
  navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, speed: 0 } });
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  roster({ 'sock-1': member(HERE.lat + 0.001, HERE.lng) });
  fireEvent.click(tabBar().getByRole('button', { name: /SCAN/ }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  expect(screen.getByText('Bravo', { selector: 'h2' })).toBeTruthy();
};

// Bravo walks ~550 m further north, over a few updates (the roster smooths positions).
const bravoWalksAway = (id = 'sock-1', extra = {}) => {
  for (let i = 0; i < 8; i++) roster({ [id]: member(HERE.lat + 0.006, HERE.lng, extra) });
};

// Same, but opened from Bravo's card in the SQUAD sheet (its AR Tracking button).
const cardArAtBravo = async () => {
  navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, speed: 0 } });
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  roster({ 'sock-1': member(HERE.lat + 0.001, HERE.lng) });
  fireEvent.click(tabBar().getByRole('button', { name: /SQUAD/ }));
  // The smallest element around Bravo's name that holds an AR Tracking button: their card.
  let card = screen.getByRole('heading', { level: 4, name: 'Bravo' });
  while (!within(card).queryByTitle('AR Tracking')) card = card.parentElement;
  fireEvent.click(within(card).getByTitle('AR Tracking'));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  expect(screen.getByText('Bravo', { selector: 'h2' })).toBeTruthy();
};

describe('AR Scan on a squad member', () => {
  it('follows them when opened from their squad card too', async () => {
    await cardArAtBravo();
    expect(proximity()).toBeLessThan(130);
    bravoWalksAway();
    expect(proximity()).toBeGreaterThan(400);
  });

  it('follows them as they move', async () => {
    await scanAtBravo();
    const before = proximity();
    expect(before).toBeGreaterThan(90);
    expect(before).toBeLessThan(130);
    bravoWalksAway();
    expect(proximity()).toBeGreaterThan(400);
  });

  it('still follows them after a reconnect gives them a new socket id', async () => {
    await scanAtBravo();
    bravoWalksAway('sock-2');
    expect(proximity()).toBeGreaterThan(400);
  });

  it('keeps their last known position when their fix drops', async () => {
    await scanAtBravo();
    bravoWalksAway();
    const last = proximity();
    roster({ 'sock-1': member(null, null) });
    expect(proximity()).toBe(last);
  });

  it('does not follow someone else', async () => {
    await scanAtBravo();
    const before = proximity();
    roster({ 'sock-1': member(HERE.lat + 0.001, HERE.lng), 'sock-9': member(HERE.lat + 0.006, HERE.lng, { uid: 'u-charlie', name: 'Charlie' }) });
    expect(proximity()).toBe(before);
  });
});
