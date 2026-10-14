// @vitest-environment jsdom
//
// Where the Emergency button stands in the design build (js-1.1.32): in the phone's tab bar,
// floating bottom-left over anything that covers that bar, and always floating from md up.
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

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
const auth = vi.hoisted(() => ({ signOut: null }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => {
  auth.signOut = vi.fn(() => Promise.resolve());
  return {
    onAuthStateChanged: (_auth, callback) => {
      callback({ uid: 'u-self', displayName: 'Alpha', photoURL: null });
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
const { SETTINGS } = await import('../src/copy/settings.js');


const { LAYER } = await import('../src/utils/layers.js');

const phone = () => {
  window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
};
const onTheMap = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
};
const tabBar = () => screen.getByRole('navigation', { name: 'Main' });
const sosButtons = () => screen.getAllByRole('button', { name: /SOS beacon/ });

beforeEach(() => {
  fakeSocket.handlers.clear();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete navigator.geolocation;
  delete window.matchMedia;
  delete document.documentElement.dataset.emergencyButton;
});

describe('the Emergency button on a phone (design build + E1: never out of reach)', () => {
  it('sits in the bottom tab bar on the map, and only one is mounted', () => {
    phone();
    onTheMap();
    expect(sosButtons()).toHaveLength(1);
    expect(tabBar().contains(sosButtons()[0])).toBe(true);
    expect(screen.queryByTestId('sos-float')).toBeNull();
    expect(document.documentElement.dataset.emergencyButton).toBeUndefined();
  });

  it('floats bottom-left above Settings, which covers the tab bar, and goes back when it closes', () => {
    phone();
    onTheMap();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.open }));
    expect(screen.getByTestId('settings')).toBeTruthy();
    expect(sosButtons()).toHaveLength(1);
    const float = screen.getByTestId('sos-float');
    expect(float.contains(sosButtons()[0])).toBe(true);
    expect(tabBar().contains(sosButtons()[0])).toBe(false);
    expect(Number(float.style.zIndex)).toBe(LAYER.emergencyButton);
    // Settings ends its content above the floating button.
    expect(document.documentElement.dataset.emergencyButton).toBe('on');

    fireEvent.click(screen.getByRole('button', { name: SETTINGS.back }));
    expect(screen.queryByTestId('sos-float')).toBeNull();
    expect(tabBar().contains(sosButtons()[0])).toBe(true);
    expect(document.documentElement.dataset.emergencyButton).toBeUndefined();
  });

  it("floats above any open bottom sheet too (a member's options)", async () => {
    phone();
    render(<App />);
    const code = document.querySelector('.sr-only').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
    await act(async () => {});
    act(() => fakeSocket.receive('users-update', {
      'sock-b': { uid: 'u-b', name: 'Bravo', roomCode: code, lat: 12.8241, lng: 80.0444, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now() },
    }));
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    expect(tabBar().contains(sosButtons()[0])).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
    expect(screen.getByRole('dialog', { name: 'Options for Bravo' })).toBeTruthy();
    expect(sosButtons()).toHaveLength(1);
    expect(screen.getByTestId('sos-float').contains(sosButtons()[0])).toBe(true);
  });

  it('from md up it always floats, and the tab bar holds none', () => {
    onTheMap();
    expect(sosButtons()).toHaveLength(1);
    expect(screen.getByTestId('sos-float').contains(sosButtons()[0])).toBe(true);
    expect(tabBar().contains(sosButtons()[0])).toBe(false);
  });
});

describe('the Firebase client config', () => {
  it('falls back to the public client config, so a build without VITE_FIREBASE_* still signs in', () => {
    const firebase = readFileSync(`${process.cwd()}/src/firebase.js`, 'utf8');
    expect(firebase).toMatch(/apiKey: import\.meta\.env\.VITE_FIREBASE_API_KEY \|\| "AIza[\w-]+"/);
    expect(firebase).not.toMatch(/\|\| ""/);
  });
});
