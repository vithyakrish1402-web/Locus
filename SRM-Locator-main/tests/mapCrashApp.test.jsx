// @vitest-environment jsdom
//
// The map crashes seen on a phone (2026-10-25), through the real App.jsx and the app-wide
// ErrorBoundary from main.jsx:
//  - "Setting map 'renderingType' after instantiation is not supported." Google's own code
//    (maps 3.66, renderingType_changed) throws whenever a map that has drawn is given a
//    renderingType again, even the same one. google-map-react hands a changed `options` prop to
//    map.setOptions() whole, and App.jsx's options carried renderingType, so the first change
//    after satellite (back to the normal map, the theme, Add Place) crashed the app.
//  - A crash inside the map took the whole app with it, SOS button included.
// The Google stand-in does what google-map-react 2.2.5 and Google do, so this proves App.jsx's
// side, not Google's rendering in a WebView.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../src/ErrorBoundary.jsx';

const fakeSocket = vi.hoisted(() => ({
  id: 'self-socket', connected: true,
  on: () => {}, off: () => {}, emit: vi.fn(),
}));
const google = vi.hoisted(() => ({ created: null, setOptions: [], mounts: 0, throws: 0 }));
const leaflet = vi.hoisted(() => ({ throws: 0, mounts: 0, props: null }));

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
  const resolve = (options) => (typeof options === 'function' ? options({}) : options);
  const shallowEqual = (a, b) => {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
  };
  return {
    default: class FakeGoogleMap extends React.Component {
      componentDidMount() {
        google.mounts += 1;
        if (google.throws > 0) {
          google.throws -= 1;
          throw new Error("Setting map 'renderingType' after instantiation is not supported.");
        }
        google.created = resolve(this.props.options);
        this.map = {
          setTilt() {}, addListener() { return { remove() {} }; }, getDiv() {},
          getCenter: () => ({ lat: () => 12.8231, lng: () => 80.0442 }), getZoom: () => 17,
          // Google, once the map has drawn (maps 3.66 renderingType_changed).
          setOptions(options) {
            google.setOptions.push(options);
            if ('renderingType' in options) throw new Error("Setting map 'renderingType' after instantiation is not supported.");
          },
        };
        this.props.onGoogleApiLoaded?.({ map: this.map });
      }
      // google-map-react: a changed `options` prop goes to map.setOptions whole.
      componentDidUpdate(prev) {
        if (google.throws > 0) {
          google.throws -= 1;
          throw new Error("Setting map 'renderingType' after instantiation is not supported.");
        }
        if (!shallowEqual(prev.options, this.props.options)) this.map.setOptions(resolve(this.props.options));
      }
      render() { return <div data-testid="google-map" />; }
    },
  };
});
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: function FakeLeafletMap(props) {
    leaflet.props = props;
    React.useEffect(() => { leaflet.mounts += 1; }, []);
    // Crashes the way the real one did: in an effect, after a render (React does not retry those).
    React.useEffect(() => {
      if (leaflet.throws > 0) {
        leaflet.throws -= 1;
        throw new TypeError("Cannot read properties of undefined (reading '_leaflet_pos')");
      }
    });
    return <div data-testid="leaflet-map" />;
  },
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

const loadApp = async (key) => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', key);
  vi.resetModules();
  return (await import('../src/App.jsx')).default;
};
const renderApp = (Root) => render(<ErrorBoundary>{React.createElement(Root)}</ErrorBoundary>);
const enterMapScreen = () => fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
const tapSatellite = () => fireEvent.click(screen.getByRole('button', { name: /satellite view|map view/i }));
const appCrashed = () => screen.queryByText('Application Error') !== null;

let errorSpy;
let warnSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  google.created = null;
  google.setOptions = [];
  google.mounts = 0;
  google.throws = 0;
  leaflet.throws = 0;
  leaflet.mounts = 0;
  try { localStorage.removeItem('locus.theme'); } catch { /* no storage */ }
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  delete navigator.geolocation;
  delete window.gm_authFailure;
});

describe("the Google map's renderingType", () => {
  it('is set when the map is made, and never again: 20 satellite round trips do not crash', { timeout: 60000 }, async () => {
    const App = await loadApp('test-key');
    renderApp(App);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    tapSatellite();
    await screen.findByTestId('google-map');
    expect(google.created.renderingType).toBe('VECTOR');
    expect(google.created.mapTypeId).toBe('hybrid');
    for (let i = 0; i < 20; i += 1) {
      tapSatellite();
      expect(appCrashed()).toBe(false);
    }
    expect(google.mounts).toBe(1);
    expect(google.setOptions.some((o) => 'renderingType' in o)).toBe(false);
  });

  it('still takes the later changes: back to the normal map, then satellite again', async () => {
    const App = await loadApp('test-key');
    renderApp(App);
    enterMapScreen();
    tapSatellite();
    await screen.findByTestId('google-map');
    tapSatellite();
    expect(google.setOptions.at(-1).mapTypeId).toBe('roadmap');
    tapSatellite();
    expect(google.setOptions.at(-1).mapTypeId).toBe('hybrid');
    expect(google.setOptions.at(-1).styles).toEqual([]);
  });
});

// A crash in the map stays in the map area (components/map/MapErrorBoundary.jsx): one automatic
// retry, then the other engine once, then a Retry button. The SOS button never goes.
describe('a map crash', () => {
  const sosStillThere = () => expect(screen.getAllByTestId('sos-button').length).toBeGreaterThan(0);
  // Any re-render of the map will do: here, opening the Group panel.
  const rerenderMap = () => fireEvent.click(screen.getAllByRole('button', { name: /^Group/ })[0]);
  const problem = () => screen.queryByTestId('map-problem')?.textContent ?? null;
  const crashLogged = () => errorSpy.mock.calls.filter(([what]) => what === '[SYS_MAP] map crashed').map(([, info]) => info);

  it('shows only a small message over the map and retries once by itself', async () => {
    const App = await loadApp('');
    renderApp(App);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    leaflet.throws = 1;
    tapSatellite(); // any re-render of the map will do
    expect(problem()).toBe('Map had a problem. Retrying…');
    expect(appCrashed()).toBe(false);
    sosStillThere();
    expect(screen.getAllByRole('button', { name: 'Settings' }).length).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(1499); });
    expect(problem()).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(problem()).toBeNull();
    expect(screen.getByTestId('leaflet-map')).toBeTruthy();
    expect(crashLogged()).toEqual([expect.objectContaining({
      engine: 'leaflet', failures: 1, message: "Cannot read properties of undefined (reading '_leaflet_pos')",
      now: expect.objectContaining({ satellite: true }),
      recentEvents: expect.arrayContaining([expect.stringMatching(/satellite off$/)]),
    })]);
  });

  it('with no other engine to try, stops after the retry and offers a Retry button', async () => {
    const App = await loadApp('');
    renderApp(App);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    leaflet.throws = 2;
    tapSatellite();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(problem()).toBe('Map had a problem.Retry');
    act(() => { vi.advanceTimersByTime(60000); });
    expect(problem()).toBe('Map had a problem.Retry'); // no more automatic tries
    sosStillThere();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(problem()).toBeNull();
    expect(screen.getByTestId('leaflet-map')).toBeTruthy();
  });

  it('a free map that crashes twice stands down for Google satellite', async () => {
    const App = await loadApp('test-key');
    renderApp(App);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    leaflet.throws = 2;
    rerenderMap();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(problem()).toBe('Map had a problem. Retrying…');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(problem()).toBeNull();
    expect(screen.getByTestId('google-map')).toBeTruthy();
    expect(screen.queryByTestId('leaflet-map')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Map/ })[0]); // close the Group panel
    expect(screen.getByRole('button', { name: 'Satellite view' })).toBeTruthy(); // the button names the view showing
    // Back to the normal map: the free map comes back.
    tapSatellite();
    expect(screen.getByTestId('leaflet-map')).toBeTruthy();
    expect(appCrashed()).toBe(false);
  });

  it('a Google map that crashes twice gives satellite to the free map, and says why', async () => {
    const App = await loadApp('test-key');
    renderApp(App);
    enterMapScreen();
    await screen.findByTestId('leaflet-map');
    tapSatellite();
    await screen.findByTestId('google-map');
    google.throws = 2;
    rerenderMap();
    expect(problem()).toBe('Map had a problem. Retrying…');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(problem()).toBe('Map had a problem. Retrying…');
    act(() => { vi.advanceTimersByTime(1500); });
    expect(problem()).toBeNull();
    expect(screen.queryByTestId('google-map')).toBeNull();
    expect(leaflet.props.isSatellite).toBe(true); // Esri photos on the free map
    expect(crashLogged().map((c) => c.googleMounted)).toEqual([true, true]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    expect(screen.getByTestId('map-engine-status').textContent).toContain('Google map stopped working');
  });
});
