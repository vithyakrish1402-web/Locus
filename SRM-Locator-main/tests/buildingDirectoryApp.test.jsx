// @vitest-environment jsdom
// Phone tab integration with authenticated group and map bridges stubbed.
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
// `user` is who signs in; a test may set it before rendering (reset after each test).
const auth = vi.hoisted(() => ({ signOut: null, user: null }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => {
  auth.signOut = vi.fn(() => Promise.resolve());
  return {
    onAuthStateChanged: (_auth, callback) => {
      callback(auth.user ?? { uid: 'u-self', displayName: 'Alpha', photoURL: null });
      return () => {};
    },
    signInWithPopup: vi.fn(),
    signOut: auth.signOut,
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    updateProfile: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
  };
});
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

beforeEach(() => {
  localStorage.removeItem('locus.group');
  fakeSocket.handlers.clear();
  window.matchMedia = q => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(navigator, 'geolocation', { configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem('locus.group'); });
function join() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
}
it('only mounts the building directory on its phone tab and opens a selected building on the map', async () => {
  join();
  expect(screen.queryByRole('searchbox', { name: 'Search campus buildings' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Buildings' }));
  expect(screen.getByRole('searchbox', { name: 'Search campus buildings' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search campus buildings' }), { target: { value: 'tech park' } });
  fireEvent.click(screen.getByRole('button', { name: 'View TECH PARK' }));
  await waitFor(() => expect(screen.queryByRole('searchbox', { name: 'Search campus buildings' })).toBeNull());
  expect(screen.getByTestId('place-navigate')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Tech Park' })).toBeTruthy(); // shown in Title Case (UI audit A6)
});
it('starts navigation with the latest action handler after browsing', async () => {
  join();
  fireEvent.click(screen.getByRole('button', { name: 'Buildings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Navigate to TECH PARK' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /End route|Exit navigation|Stop navigation/i })).toBeTruthy());
  expect(screen.queryByRole('searchbox', { name: 'Search campus buildings' })).toBeNull();
});
