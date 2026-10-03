// @vitest-environment jsdom
//
// Which map the app is running, as SYS_CONFIG reports it, through the real App.jsx:
// key set + Google loads, no key, Google never loads (the 8 s watchdog), and Google
// rejecting the key (window.gm_authFailure). Both engines are stood in for, so this
// proves the switch and the wording, not what Google does in a WebView.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

const fakeSocket = vi.hoisted(() => ({
  id: 'self-socket', connected: true,
  on: () => {}, off: () => {}, emit: vi.fn(),
}));
// Whether the stand-in Google map reports itself loaded.
const google = vi.hoisted(() => ({ loads: true }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback({ uid: 'u-self', displayName: 'Alpha', photoURL: null });
    return () => {};
  },
  signInWithPopup: vi.fn(), signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(), updateProfile: vi.fn(), sendPasswordResetEmail: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: () => Promise.resolve({ remove: () => {} }), minimizeApp: vi.fn() },
}));
vi.mock('google-map-react', async () => {
  const React = await import('react');
  return {
    default: function FakeGoogleMap({ onGoogleApiLoaded }) {
      React.useEffect(() => {
        if (google.loads) onGoogleApiLoaded?.({ map: { setTilt() {}, getDiv() {}, getCenter: () => ({ lat: () => 0, lng: () => 0 }), getZoom: () => 17 } });
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="google-map" />;
    },
  };
});
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({ default: () => <div data-testid="leaflet-map" /> }));
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

// The Maps key is read once, when App.jsx is first evaluated, so each case loads its own copy.
const loadApp = async (key) => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', key);
  vi.resetModules();
  return (await import('../src/App.jsx')).default;
};

const enterMapScreen = () => {
  fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
};
const statusText = () => {
  fireEvent.click(screen.getByTitle('System Configuration (SYS_CONFIG)'));
  return screen.getByTestId('map-engine-status').textContent;
};

let warnSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  google.loads = true;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  warnSpy.mockRestore();
  delete navigator.geolocation;
  delete window.gm_authFailure;
});

describe('the map status line in SYS_CONFIG', () => {
  it('says Google, with no reason, when the key is set and Google loads', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    expect(await screen.findByTestId('google-map')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(9000); });
    expect(screen.queryByTestId('leaflet-map')).toBeNull();
    expect(statusText()).toBe('Map: Google');
  });

  it('says Backup, with "No Google Maps key in this build", when the build has no key', async () => {
    const App = await loadApp('');
    render(<App />);
    enterMapScreen();
    expect(await screen.findByTestId('leaflet-map')).toBeTruthy();
    expect(statusText()).toBe('Map: Backup (OpenStreetMap)No Google Maps key in this build');
  });

  it('falls back after the 8 s watchdog when Google never loads, and says why', async () => {
    google.loads = false;
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    expect(await screen.findByTestId('google-map')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(7900); });
    expect(screen.queryByTestId('leaflet-map')).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(await screen.findByTestId('leaflet-map')).toBeTruthy();
    expect(statusText()).toBe('Map: Backup (OpenStreetMap)Google map could not load (slow or no connection)');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason: timeout'));
  });

  it('falls back when Google rejects the key (gm_authFailure), and says why', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    expect(await screen.findByTestId('google-map')).toBeTruthy();
    expect(typeof window.gm_authFailure).toBe('function');
    act(() => window.gm_authFailure());
    expect(await screen.findByTestId('leaflet-map')).toBeTruthy();
    expect(statusText()).toBe('Map: Backup (OpenStreetMap)Google rejected the map key');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason: key-rejected'));
    // One-way, and the handler is gone with the Google map.
    expect(window.gm_authFailure).toBeUndefined();
  });

  it('keeps the first reason: a late watchdog does not overwrite key-rejected', async () => {
    google.loads = false;
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    await screen.findByTestId('google-map');
    act(() => window.gm_authFailure());
    act(() => { vi.advanceTimersByTime(9000); });
    expect(statusText()).toContain('Google rejected the map key');
  });

  it('puts back a gm_authFailure that was already there when the Google map goes away', async () => {
    const theirs = vi.fn();
    window.gm_authFailure = theirs;
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    await screen.findByTestId('google-map');
    expect(window.gm_authFailure).not.toBe(theirs);
    act(() => window.gm_authFailure());
    expect(window.gm_authFailure).toBe(theirs);
  });
});
