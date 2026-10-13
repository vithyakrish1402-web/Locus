// @vitest-environment jsdom
//
// The Floor 7 debug overlay in the real App.jsx: it is on the screen only in the test build
// (FLOOR7_DEMO, which is Vite mode 'sidetest'), and then only for the owner. In every other
// build the flag is the constant `false`, the overlay's chunk is never requested here and is
// left out of the output (tests/floor7Build.test.js proves the latter with a real build:
// the marker "floor7-debug" is in the sidetest bundle and in no other).
//
// The fusion controller, socket, Firebase, native plugins and the Google map are faked as in
// indoorLocate.test.jsx; the position flags are forced as each test says.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { readFileSync } from 'node:fs';
import { MotionGlobalConfig } from 'framer-motion';

MotionGlobalConfig.skipAnimations = true;
// jsdom's frame timing. What is animated is not under test here.
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
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
  };
});

// The fusion controller (its numbers are not under test here).
const fake = vi.hoisted(() => ({ indoor: null, listeners: new Set(), started: 0 }));
// Who is signed in: the owner's email makes isAdmin true in App.jsx.
const signedIn = vi.hoisted(() => ({ email: null }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback({ uid: 'u-self', displayName: 'Alpha', photoURL: null, email: signedIn.email });
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
// The Google engine without its canvas: children are placed as plain divs carrying their
// lat/lng, exactly the elements App.jsx hands google-map-react.
vi.mock('google-map-react', () => ({
  default: function FakeGoogleMap({ children, onGoogleApiLoaded }) {
    useEffect(() => {
      onGoogleApiLoaded?.({ map: { setTilt() {} } });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="google-map">{children}</div>;
  },
}));
vi.mock('../src/utils/wifiFusion.js', () => ({
  startWifiFusion: () => {
    fake.started++;
    return {
      resolve: (gps) =>
        fake.indoor
          ? { lat: fake.indoor.lat, lng: fake.indoor.lng, positionSource: 'wifi' }
          : { lat: gps.lat, lng: gps.lng, positionSource: 'gps' },
      indoor: () => fake.indoor,
      subscribe: (listener) => {
        fake.listeners.add(listener);
        return () => fake.listeners.delete(listener);
      },
      stop: () => {},
    };
  },
}));
// The survey table, for the floor picker in a building you're in without a reading.
vi.mock('../src/utils/wifiPositioning.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessPoints: async () =>
    new Map([0, 1, 2, 7].map((floor) => [`ap-${floor}`, { lat: 0, lng: 0, building: 'TECH PARK', floor, ambiguousFloor: false }])),
}));
vi.mock('../src/hooks/useLiveUpdate.js', () => ({
  useLiveUpdate: () => ({ status: 'idle', supported: false, restart: vi.fn() }),
}));
vi.mock('../src/hooks/useAppUpdate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAppUpdate: () => ({
      supported: false, status: actual.UpdateStatus.IDLE, manifest: null, installedVersion: null,
      progress: { percent: -1, loaded: 0, total: 0 }, error: null, mandatory: false, dismissed: false,
      check: vi.fn(), startDownload: vi.fn(), openInstallSettings: vi.fn(), dismiss: vi.fn(),
    }),
  };
});

vi.setConfig({ testTimeout: 20_000 });

const CODE = 'KTR7X9';
const OWNER = 'vithyakrish1402@gmail.com';
const overlayLoads = vi.hoisted(() => ({ count: 0 }));

/** A fresh App with the Floor 7 demo flag as given. */
async function loadApp({ demo }) {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
  vi.doMock('../src/utils/positionSource.js', async (importOriginal) => ({
    ...(await importOriginal()),
    WIFI_POSITIONING_ENABLED: true,
    FLOOR7_DEMO: demo,
  }));
  // Stands in for the overlay, and counts how often its module is loaded at all.
  vi.doMock('../src/components/Floor7DebugOverlay.jsx', () => {
    overlayLoads.count++;
    return { default: () => createElement('div', { 'data-testid': 'floor7-overlay' }, 'F7 debug') };
  });
  vi.doMock('../src/utils/floor7Demo.js', () => ({ floor7FusionOptions: () => ({}) }));
  return (await import('../src/App.jsx')).default;
}

async function joinSquad(App) {
  render(createElement(App));
  fireEvent.click(screen.getByRole('radio', { name: 'Join a group' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: CODE } });
  fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: CODE }));
  await waitFor(() => expect(fake.started).toBe(1));
}

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  fake.indoor = null;
  fake.listeners.clear();
  fake.started = 0;
  signedIn.email = null;
  overlayLoads.count = 0;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: 12.8231, longitude: 80.0442, speed: 0 } })),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock('../src/utils/positionSource.js');
  vi.doUnmock('../src/components/Floor7DebugOverlay.jsx');
  vi.doUnmock('../src/utils/floor7Demo.js');
  delete navigator.geolocation;
});

describe('the Floor 7 debug overlay in App.jsx', () => {
  it('is shown to the owner in the test build', async () => {
    signedIn.email = OWNER;
    await joinSquad(await loadApp({ demo: true }));
    expect(await screen.findByTestId('floor7-overlay')).toBeTruthy();
  });

  it('is never shown to anyone else, even in the test build, and is not even loaded', async () => {
    signedIn.email = 'someone@example.com';
    await joinSquad(await loadApp({ demo: true }));
    await act(async () => {});
    expect(screen.queryByTestId('floor7-overlay')).toBeNull();
    expect(overlayLoads.count).toBe(0);
  });

  it('is not shown, and its code is never requested, in any other build, owner or not', async () => {
    signedIn.email = OWNER;
    await joinSquad(await loadApp({ demo: false }));
    await act(async () => {});
    expect(screen.queryByTestId('floor7-overlay')).toBeNull();
    expect(overlayLoads.count).toBe(0);
  });
});

describe('how App.jsx wires it', () => {
  const app = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8').replace(/\r\n/g, '\n');

  it('imports it only when FLOOR7_DEMO is on, so a normal build has no import to follow', () => {
    expect(app).toMatch(/const Floor7DebugOverlay = FLOOR7_DEMO \? React\.lazy\(\(\) => import\('\.\/components\/Floor7DebugOverlay'\)\) : null;/);
    expect(app.match(/Floor7DebugOverlay/g)).toHaveLength(3); // the const, its import, its one render
  });

  it('renders it from one place, behind FLOOR7_DEMO and the owner check', () => {
    expect(app).toContain('{FLOOR7_DEMO && isAdmin && <Suspense fallback={null}><Floor7DebugOverlay /></Suspense>}');
  });
});
