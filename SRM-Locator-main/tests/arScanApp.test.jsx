// @vitest-environment jsdom
//
// AR Scan (redesign AR Scan batch), through the real App.jsx: the Emergency button above it,
// the target and its picker, the road line, the readout and the notices. Only the app's edges
// are stubbed (socket transport, Firebase, native plugins, maps, the update hooks).
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

MotionGlobalConfig.skipAnimations = true;

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
    timeout: () => ({ emit: vi.fn() }),
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
  signOut: vi.fn(() => Promise.resolve()),
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
const { LAYER } = await import('../src/utils/layers.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
let code;
const member = (id, extra = {}) => ({
  [`sock-${id}`]: { uid: `u-${id}`, name: id, roomCode: code, lat: HERE.lat + 0.001, lng: HERE.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now(), ...extra },
});
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const sos = () => screen.getByRole('button', { name: /SOS beacon/ });

/** On the map in a group of your own, with members, then the Scan tab (AR Scan's start screen). */
const scanning = async (members = () => member('Bravo')) => {
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  act(() => fakeSocket.receive('users-update', members()));
  fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
};
const startArScan = async () => act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  // The camera was allowed before, so AR Scan opens without its explainer.
  try { localStorage.setItem('locus.cameraAllowed', '1'); } catch { /* no storage */ }
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, speed: 0 } })),
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

describe('the Emergency button and AR Scan', () => {
  it('stands above AR Scan while it is open, its start screen included, in the same spot', async () => {
    await scanning();
    expect(screen.getByTestId('ar-start')).toBeTruthy();
    expect(Number(sos().style.zIndex)).toBe(LAYER.emergencyButtonOverArScan);
    await startArScan();
    expect(screen.getByTestId('ar-scan')).toBeTruthy();
    expect(Number(sos().style.zIndex)).toBe(LAYER.emergencyButtonOverArScan);
    expect(Number(sos().style.zIndex)).toBeGreaterThan(Number(screen.getByTestId('ar-scan').style.zIndex));
    expect(sos().className).toMatch(/(^| )bottom-20 left-4( |$)/);
  });

  it('goes back to its own layer once AR Scan closes', async () => {
    await scanning();
    fireEvent.click(within(screen.getByTestId('ar-start')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('ar-start')).toBeNull();
    expect(sos().style.zIndex).toBe('');
  });

  it('an incoming alert still draws over it', () => {
    expect(LAYER.emergency).toBeGreaterThan(LAYER.emergencyButtonOverArScan);
  });

  it("AR Scan's own bottom content stays clear of it: its start buttons and its readout", () => {
    // jsdom drops env() from inline styles, so this reads the source: both use the clearance,
    // which is the button's 5 rem up plus its 5 rem height, plus 1 rem.
    const ar = readFileSync(`${process.cwd()}/src/ARCompass.jsx`, 'utf8');
    expect(ar).toContain("export const CLEAR_OF_EMERGENCY_BUTTON = 'calc(11rem + env(safe-area-inset-bottom))';");
    expect(ar.match(/paddingBottom: CLEAR_OF_EMERGENCY_BUTTON/g)).toHaveLength(2);
    const trigger = readFileSync(`${process.cwd()}/src/components/SosTrigger.jsx`, 'utf8');
    expect(trigger).toMatch(/bottom-20 left-4 [^"]*w-20 h-20/);
  });
});
