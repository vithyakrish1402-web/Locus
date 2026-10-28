// @vitest-environment jsdom
//
// Developer mode in the real App.jsx: visible only to the admin account, only in the test build
// (FLOOR7_DEMO, which is Vite mode 'sidetest'), only when signed in as that account and online; never
// loaded for anyone else; off after sign-out; and the old floating F7 pill is gone. In every
// other build the flag is the constant `false`, none of its chunks is requested here and none
// is in the output (tests/floor7Build.test.js proves the latter with a real build).
//
// Socket, Firebase, native plugins and the Google map are faked as in indoorLocate.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { readFileSync } from 'node:fs';
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
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
  };
});
const auth = vi.hoisted(() => ({ user: null, callback: null }));
const loads = vi.hoisted(() => ({ screen: 0, overlay: 0 }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    auth.callback = callback;
    callback(auth.user);
    return () => { auth.callback = null; };
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
vi.mock('google-map-react', () => ({
  default: function FakeGoogleMap({ children, onGoogleApiLoaded }) {
    useEffect(() => {
      onGoogleApiLoaded?.({ map: { setTilt() {} } });
    }, []);
    return <div data-testid="google-map">{children}</div>;
  },
}));
vi.mock('../src/utils/wifiFusion.js', () => ({
  startWifiFusion: () => ({
    resolve: (gps) => ({ lat: gps.lat, lng: gps.lng, positionSource: 'gps' }),
    indoor: () => null,
    subscribe: () => () => {},
    stop: () => {},
  }),
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

const ADMIN = 'vithyakrish1402@gmail.com';
const admin = { uid: 'u-admin', displayName: 'Alpha', photoURL: null, email: ADMIN, emailVerified: false };

/** A fresh App with the test-build flag as given; the heavy Developer mode screens are stubs that count their loads. */
async function loadApp({ demo }) {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
  vi.doMock('../src/utils/positionSource.js', async (importOriginal) => ({
    ...(await importOriginal()),
    WIFI_POSITIONING_ENABLED: demo,
    FLOOR7_DEMO: demo,
  }));
  vi.doMock('../src/components/devmode/DeveloperScreen.jsx', () => {
    loads.screen++;
    return { default: ({ open, overlayOn, onOverlay }) => createElement('div', { 'data-testid': 'developer-screen', hidden: !open }, 'Developer mode screen',
      createElement('button', { onClick: () => onOverlay(!overlayOn) }, 'overlay')) };
  });
  vi.doMock('../src/components/Floor7DebugOverlay.jsx', () => {
    loads.overlay++;
    return { default: () => createElement('div', { 'data-testid': 'floor7-map-overlay' }, 'plan') };
  });
  return (await import('../src/App.jsx')).default;
}

const CODE = 'KTR7X9';
const topBarSettings = async () => within(await screen.findByRole('navigation', { name: 'Top bar' })).getByRole('button', { name: 'Settings' });
/** Joins a group (the lobby comes first), which brings up the main map screen. */
async function joinSquad(App) {
  render(createElement(App));
  fireEvent.click(await screen.findByRole('radio', { name: 'Join a group' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: CODE } });
  fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: CODE }));
  await topBarSettings();
}

const openSettings = async () => {
  fireEvent.click(await topBarSettings());
  return screen.findByTestId('settings-layer');
};
const setOnline = (online) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });

beforeEach(() => {
  fakeSocket.handlers.clear();
  window.localStorage.clear();
  auth.user = null;
  loads.screen = 0;
  loads.overlay = 0;
  setOnline(true);
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
  vi.doUnmock('../src/components/devmode/DeveloperScreen.jsx');
  vi.doUnmock('../src/components/Floor7DebugOverlay.jsx');
  delete navigator.geolocation;
});

describe('Developer mode in App.jsx', () => {
  it('shows the admin the Settings row; turning it on opens the screen and shows the badge', async () => {
    auth.user = admin;
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    await openSettings();
    const row = await screen.findByRole('switch', { name: /Developer mode/ });
    expect(screen.getByText('Tools for testing. Admin accounts only.')).toBeTruthy();
    expect(screen.queryByTestId('developer-badge')).toBeNull(); // off by default
    expect(loads.screen).toBe(0); // the screen's code is not even requested yet
    fireEvent.click(row);
    expect(await screen.findByTestId('developer-badge')).toBeTruthy();
    expect((await screen.findByTestId('developer-screen')).hidden).toBe(false);
    expect(window.localStorage.getItem('locus.developerMode')).toBe('u-admin');
  });

  it('the badge brings the screen back after it was closed', async () => {
    auth.user = admin;
    window.localStorage.setItem('locus.developerMode', 'u-admin'); // already on from an earlier launch
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    const badge = await screen.findByTestId('developer-badge');
    expect(screen.queryByTestId('developer-screen')).toBeNull(); // not opened yet: not loaded
    fireEvent.click(badge);
    expect((await screen.findByTestId('developer-screen')).hidden).toBe(false);
  });

  it('has no floating F7 pill on the main map screen, even for the admin with Developer mode on', async () => {
    auth.user = admin;
    window.localStorage.setItem('locus.developerMode', 'u-admin');
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    await screen.findByTestId('developer-badge');
    expect(screen.queryByRole('button', { name: /F7/ })).toBeNull();
    expect(screen.queryByText(/F7 (debug|hide)/)).toBeNull();
    expect(screen.queryByTestId('floor7-map-overlay')).toBeNull(); // the plan is off until its card is switched on
  });

  it('shows the plan on the main map only when its card is switched on', async () => {
    auth.user = admin;
    window.localStorage.setItem('locus.developerMode', 'u-admin');
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    fireEvent.click(await screen.findByTestId('developer-badge'));
    fireEvent.click(await screen.findByRole('button', { name: 'overlay' }));
    expect(await screen.findByTestId('floor7-map-overlay')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'overlay' }));
    await waitFor(() => expect(screen.queryByTestId('floor7-map-overlay')).toBeNull());
  });

  it('never shows a non-admin the row or the badge, and never requests the code', async () => {
    auth.user = { ...admin, uid: 'u-other', email: 'someone@example.com' };
    window.localStorage.setItem('locus.developerMode', 'u-other'); // even with a stale setting
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    await openSettings();
    await act(async () => {});
    expect(screen.queryByRole('switch', { name: /Developer mode/ })).toBeNull();
    expect(screen.queryByTestId('developer-badge')).toBeNull();
    expect(loads.screen + loads.overlay).toBe(0);
    expect(window.localStorage.getItem('locus.developerMode')).toBeNull(); // and the stale setting is forgotten
  });

  it('shows it to the admin\'s email and password account, which is never email-verified', async () => {
    auth.user = { ...admin, emailVerified: false };
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    await openSettings();
    expect(await screen.findByRole('switch', { name: /Developer mode/ })).toBeTruthy();
  });

  it('hides it while offline, without forgetting it, and brings it back online', async () => {
    auth.user = admin;
    window.localStorage.setItem('locus.developerMode', 'u-admin');
    setOnline(false);
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    await openSettings();
    await act(async () => {});
    expect(screen.queryByRole('switch', { name: /Developer mode/ })).toBeNull();
    expect(screen.queryByTestId('developer-badge')).toBeNull();
    expect(window.localStorage.getItem('locus.developerMode')).toBe('u-admin');
    setOnline(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(await screen.findByRole('switch', { name: /Developer mode/ })).toBeTruthy();
    expect(await screen.findByTestId('developer-badge')).toBeTruthy();
  });

  it('switches off, and is forgotten, when the admin signs out', async () => {
    auth.user = admin;
    window.localStorage.setItem('locus.developerMode', 'u-admin');
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    await screen.findByTestId('developer-badge');
    act(() => auth.callback(null));
    await waitFor(() => expect(screen.queryByTestId('developer-badge')).toBeNull());
    expect(window.localStorage.getItem('locus.developerMode')).toBeNull();
    act(() => auth.callback(admin)); // signing back in: still off
    await topBarSettings();
    expect(screen.queryByTestId('developer-badge')).toBeNull();
  });

  it('switches off when the account stops being admin', async () => {
    auth.user = admin;
    window.localStorage.setItem('locus.developerMode', 'u-admin');
    const App = await loadApp({ demo: true });
    await joinSquad(App);
    await screen.findByTestId('developer-badge');
    act(() => auth.callback({ ...admin, email: 'moved@example.com' }));
    await waitFor(() => expect(screen.queryByTestId('developer-badge')).toBeNull());
    expect(window.localStorage.getItem('locus.developerMode')).toBeNull();
  });

  it('is not in any other build: no row, no badge, nothing requested, even for the admin with a stored setting', async () => {
    auth.user = admin;
    window.localStorage.setItem('locus.developerMode', 'u-admin');
    const App = await loadApp({ demo: false });
    await joinSquad(App);
    await openSettings();
    await act(async () => {});
    expect(screen.queryByRole('switch', { name: /Developer mode/ })).toBeNull();
    expect(screen.queryByTestId('developer-badge')).toBeNull();
    expect(loads.screen + loads.overlay).toBe(0);
  });
});

describe('how App.jsx wires it', () => {
  const app = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8').replace(/\r\n/g, '\n');

  it('requests each Developer mode chunk only when FLOOR7_DEMO is on, so a normal build has nothing to follow', () => {
    for (const name of ['Floor7DebugOverlay', 'DeveloperModeRow', 'DeveloperBadge', 'DeveloperScreen']) {
      expect(app, name).toMatch(new RegExp(`const ${name} = FLOOR7_DEMO \\? React\\.lazy\\(\\(\\) => import\\('\\./components/(devmode/)?${name}'\\)\\) : null;`));
    }
    expect(app).toContain('const useDeveloper = FLOOR7_DEMO ? useDeveloperMode :');
  });

  it('renders the three parts from one place each, behind the flag and the admin check', () => {
    expect(app).toContain('{FLOOR7_DEMO && developer.on && (');
    expect(app).toContain("developerSlot={FLOOR7_DEMO && developer.status === 'admin' ? (");
    expect(app).not.toMatch(/FLOOR7_DEMO && isAdmin && <Suspense/); // the old F7 pill line
    expect(app).not.toMatch(/Floor7RecorderPanel|floor7Recorder/);
  });

  it('keeps the admin rule in one place: developerStatus, which fails closed', () => {
    const rule = readFileSync(`${process.cwd()}/src/utils/developerMode.js`, 'utf8');
    expect(rule).toContain("if (authLoading || !online) return 'unknown';");
    expect(rule).toContain("user && user.email === adminEmail");
    expect(rule).not.toContain('emailVerified');
  });
});
