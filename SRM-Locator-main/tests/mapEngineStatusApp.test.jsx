// @vitest-environment jsdom
//
// Which map the app is running, as Settings reports it, through the real App.jsx:
// key set + Google loads, no key, Google never loads (the 8 s watchdog), and Google
// rejecting the key (window.gm_authFailure). Both engines are stood in for, so this
// proves the switch and the wording, not what Google does in a WebView.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

const fakeSocket = vi.hoisted(() => ({
  id: 'self-socket', connected: true,
  on: () => {}, off: () => {}, emit: vi.fn(),
}));
// Whether the stand-in Google map reports itself loaded.
const google = vi.hoisted(() => ({ loads: true, options: null, mounts: 0 }));
const leaflet = vi.hoisted(() => ({ props: null, mounts: 0 }));
const googleLine = vi.hoisted(() => ({ args: null }));

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
    default: function FakeGoogleMap({ onGoogleApiLoaded, options }) {
      google.options = options;
      React.useEffect(() => { google.mounts += 1; }, []);
      React.useEffect(() => {
        if (google.loads) onGoogleApiLoaded?.({ map: { setTilt() {}, addListener() { return { remove() {} }; }, getDiv() {}, getCenter: () => ({ lat: () => 0, lng: () => 0 }), getZoom: () => 17 } });
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="google-map" />;
    },
  };
});
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: (props) => {
    leaflet.props = props;
    React.useEffect(() => { leaflet.mounts += 1; }, []);
    return <div data-testid="leaflet-map" />;
  },
}));
// The Google walking line's colours, as App.jsx hands them over.
vi.mock('../src/hooks/useWaypointNavigationLine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useWaypointNavigationLine: (...args) => { googleLine.args = args; },
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

// The Maps key is read once, when App.jsx is first evaluated, so each case loads its own copy.
const loadApp = async (key) => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', key);
  vi.resetModules();
  return (await import('../src/App.jsx')).default;
};

const enterMapScreen = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
};
// The one thing that asks for Google. The same button turns satellite off again.
const tapSatellite = () => fireEvent.click(screen.getByRole('button', { name: /satellite view|map view/i }));
const statusText = () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
  return screen.getByTestId('map-engine-status').textContent.replace(/\s*·\s*/g, '');
};

let warnSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  google.loads = true;
  google.options = null;
  google.mounts = 0;
  leaflet.mounts = 0;
  try { localStorage.removeItem('locus.theme'); } catch { /* no storage */ }
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

describe("the map status line in Settings' More section", () => {
  it('says the free map is in use, with no reason, until satellite is asked for', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    expect(await screen.findByTestId('leaflet-map')).toBeTruthy();
    expect(screen.queryByTestId('google-map')).toBeNull();
    expect(statusText()).toBe('Map: OpenStreetMap (Google on satellite)');
  });

  it('says Google, with no reason, when the key is set and satellite has loaded Google', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    tapSatellite();
    expect(await screen.findByTestId('google-map')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(9000); });
    expect(statusText()).toBe('Map: Google');
  });

  it('says Backup, with "No Google Maps key in this build", when the build has no key', async () => {
    const App = await loadApp('');
    render(<App />);
    enterMapScreen();
    expect(await screen.findByTestId('leaflet-map')).toBeTruthy();
    expect(statusText()).toBe('Map: Backup (OpenStreetMap)No Google Maps key in this build');
  });

  it('with no key, satellite is the free map on Esri imagery and Google is never built', async () => {
    const App = await loadApp('');
    render(<App />);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    tapSatellite();
    expect(screen.queryByTestId('google-map')).toBeNull();
    expect(leaflet.props.isSatellite).toBe(true);
  });

  it('falls back after the 8 s watchdog when Google never loads, and says why', async () => {
    google.loads = false;
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    // Nothing waits on Google until satellite asks for it.
    act(() => { vi.advanceTimersByTime(20000); });
    expect(statusText()).toBe('Map: OpenStreetMap (Google on satellite)');
    tapSatellite();
    expect(await screen.findByTestId('google-map')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(7900); });
    expect(screen.queryByTestId('google-map')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByTestId('google-map')).toBeNull();
    expect(statusText()).toBe('Map: Backup (OpenStreetMap)Google map could not load (slow or no connection)');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason: timeout'));
    // Satellite is now the free map on Esri imagery.
    expect(leaflet.props.isSatellite).toBe(true);
  });

  it('falls back when Google rejects the key (gm_authFailure), and says why', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    expect(window.gm_authFailure).toBeUndefined();
    tapSatellite();
    expect(await screen.findByTestId('google-map')).toBeTruthy();
    expect(typeof window.gm_authFailure).toBe('function');
    act(() => window.gm_authFailure());
    expect(screen.queryByTestId('google-map')).toBeNull();
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
    tapSatellite();
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
    tapSatellite();
    await screen.findByTestId('google-map');
    expect(window.gm_authFailure).not.toBe(theirs);
    act(() => window.gm_authFailure());
    expect(window.gm_authFailure).toBe(theirs);
  });
});

// The satellite routing rule: the free map is the map; Google is built by the first satellite
// tap and by nothing else, once, then only hidden and shown.
describe('satellite routing', () => {
  const layer = (id) => screen.getByTestId(id);
  const visible = (id) => layer(id).style.visibility === 'visible';

  it('cold start with a key present builds no Google map and shows the free one', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    expect(await screen.findByTestId('leaflet-map')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.queryByTestId('google-map')).toBeNull();
    expect(screen.queryByTestId('google-map-layer')).toBeNull();
    expect(google.mounts).toBe(0);
    expect(window.google).toBeUndefined();
    expect(window.gm_authFailure).toBeUndefined();
    expect(leaflet.props.isSatellite).toBe(false);
    expect(visible('free-map-layer')).toBe(true);
  });

  it('the first satellite tap builds Google once; five more round trips build nothing', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    tapSatellite();
    const googleNode = await screen.findByTestId('google-map');
    expect(google.mounts).toBe(1);
    expect(visible('google-map-layer')).toBe(true);
    expect(visible('free-map-layer')).toBe(false);
    // Google, not the free engine on other tiles, is what satellite shows.
    expect(leaflet.props.isSatellite).toBe(false);

    for (let i = 0; i < 5; i += 1) {
      tapSatellite(); // back to the normal map
      expect(visible('free-map-layer')).toBe(true);
      expect(visible('google-map-layer')).toBe(false);
      tapSatellite(); // satellite again
      expect(visible('google-map-layer')).toBe(true);
      expect(visible('free-map-layer')).toBe(false);
    }
    expect(google.mounts).toBe(1);
    expect(screen.getByTestId('google-map')).toBe(googleNode);
    // The free map was never torn down either.
    expect(leaflet.mounts).toBe(1);
  });

  it('keeps showing the free map while Google is still loading, rather than a blank', async () => {
    google.loads = false;
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    tapSatellite();
    expect(visible('free-map-layer')).toBe(true);
    expect(visible('google-map-layer')).toBe(false);
  });

  it('a hidden Google map cannot be touched', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    tapSatellite();
    await screen.findByTestId('google-map');
    tapSatellite();
    expect(layer('google-map-layer').style.pointerEvents).toBe('none');
  });
});

// Google only ever shows satellite photos now, so no roadmap style reaches it; the free map
// takes the theme through its tile filter.
describe('the Google map style', () => {
  it('is satellite photos with no style', async () => {
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    tapSatellite();
    await screen.findByTestId('google-map');
    // A function, read once when the map is made (see mapCrashApp.test.jsx).
    const made = google.options();
    expect(made.styles).toEqual([]);
    expect(made.mapTypeId).toBe('hybrid');
  });
});

// The route stays blue with a white outline in both themes, independently of map tokens.
describe('the walking line colours reaching the map', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--color-map-route');
    document.documentElement.style.removeProperty('--color-map-casing');
  });

  it.each(['light', 'dark'])('stays blue with a white outline in the %s theme on Leaflet', async (theme) => {
    localStorage.setItem('locus.theme', theme);
    document.documentElement.style.setProperty('--color-map-route', '#8FB1FF');
    document.documentElement.style.setProperty('--color-map-casing', '#0E1116');
    const App = await loadApp('');
    render(<App />);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    expect(leaflet.props.routeColor).toBe('#1A73E8');
    expect(leaflet.props.casingColor).toBe('#FFFFFF');
  });

  it.each(['light', 'dark'])('stays blue with a white outline in the %s theme on Google', async (theme) => {
    localStorage.setItem('locus.theme', theme);
    document.documentElement.style.setProperty('--color-map-route', '#8FB1FF');
    document.documentElement.style.setProperty('--color-map-casing', '#0E1116');
    const App = await loadApp('test-key');
    render(<App />);
    enterMapScreen();
    tapSatellite();
    await screen.findByTestId('google-map');
    expect(googleLine.args.slice(3)).toEqual(['#1A73E8', '#FFFFFF']);
  });
});
