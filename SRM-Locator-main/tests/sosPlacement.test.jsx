// @vitest-environment jsdom
//
// Where the Emergency button stands in the design build (js-1.1.32): in the phone's tab bar,
// floating bottom-left over anything that covers that bar, and always floating from md up.
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
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
// The real route lookup, unless a test sets `straightRoute.on`: then a straight line from origin
// to destination, so navigation can reach its destination with no network.
const straightRoute = vi.hoisted(() => ({ on: false }));
vi.mock('../src/utils/routingProviders', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    fetchPedestrianRoute: (origin, dest, engine) => (straightRoute.on
      ? Promise.resolve({ path: [origin, dest], steps: [], distance: { text: '' }, duration: { text: '' } })
      : real.fetchPedestrianRoute(origin, dest, engine)),
  };
});
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

  // Krish, 2026-10-16: the floating button sat over Settings' own text ("Keep sharing when the app
  // is closed"), so it is not shown in Settings at all. It is back the moment Settings closes.
  it.each([['a phone', true], ['a wide screen', false]])('is not shown while Settings is open on %s, and is back when it closes', (_, onPhone) => {
    window.matchMedia = (q) => ({ matches: onPhone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    onTheMap();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.open }));
    expect(screen.getByTestId('settings')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /SOS beacon/ })).toHaveLength(0);
    expect(screen.queryByTestId('sos-float')).toBeNull();
    // No room is kept for it at the end of Settings' content either.
    expect(document.documentElement.dataset.emergencyButton).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: SETTINGS.back }));
    expect(sosButtons()).toHaveLength(1);
    if (onPhone) {
      expect(screen.queryByTestId('sos-float')).toBeNull();
      expect(tabBar().contains(sosButtons()[0])).toBe(true);
      expect(document.documentElement.dataset.emergencyButton).toBeUndefined();
    } else {
      expect(screen.getByTestId('sos-float').contains(sosButtons()[0])).toBe(true); // from md up it always floats
    }
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

// Turn-by-turn navigation (Jose's 09086a7) hides the bottom bar the Emergency button sits in. The
// button must then float, as it does over AR Scan or a sheet: never out of reach. Only where it
// stands is tested here; how it behaves is covered by sosTrigger.test.jsx and is unchanged.
describe('the Emergency button during turn-by-turn navigation', () => {
  const startNavigating = async () => {
    phone();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    onTheMap();
    await act(async () => {});
    fireEvent.click(screen.getByRole('radio', { name: 'Buildings' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Navigate to / })[0]);
    await act(async () => {});
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it('floats bottom-left on a phone while the bottom bar is hidden, one button, on its one layer', async () => {
    await startNavigating();
    expect(screen.getByTestId('turn-instruction-card')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull(); // the bar is hidden...
    expect(sosButtons()).toHaveLength(1); // ...and the button is not
    const float = screen.getByTestId('sos-float');
    expect(float.contains(sosButtons()[0])).toBe(true);
    expect(Number(float.style.zIndex)).toBe(LAYER.emergencyButton);
  });

  // On the emulator the floating button sat on the trip summary card ("8 min · 713 m"), over its
  // text. jsdom has no layout, so this reads each piece's Tailwind bottom offset (in rem) and
  // checks the button starts above the summary card and above the speed badge stacked on it.
  it('stands above the trip summary card and the speed badge, not over them', async () => {
    await startNavigating();
    const rem = (el, prefix) => {
      const cls = [...el.classList].find((c) => c.startsWith(prefix));
      if (!cls) return null;
      const arbitrary = /\[(\d+(?:\.\d+)?)rem\]$/.exec(cls);
      return arbitrary ? Number(arbitrary[1]) : Number(cls.slice(prefix.length)) * 0.25;
    };
    const fixedParent = (el) => { let n = el; while (n && !n.classList.contains('fixed')) n = n.parentElement; return n; };

    const card = fixedParent(screen.getByTestId('navigation-summary-card'));
    const badge = fixedParent(screen.getByText('km/h'));
    const float = screen.getByTestId('sos-float');
    const cardBottom = rem(card, 'bottom-');
    const badgeTop = rem(badge, 'bottom-') + rem(badge.firstElementChild, 'h-');
    const floatBottom = rem(float, 'bottom-');

    expect(cardBottom).not.toBeNull();
    expect(floatBottom).toBeGreaterThan(badgeTop); // above the badge, so above the card it sits on
    expect(floatBottom).toBeGreaterThan(cardBottom);
    expect([...float.classList].some((c) => c.startsWith('md:bottom-'))).toBe(false); // wide screens too

    // Its hold card ("Hold again to send…") is placed by SosTrigger at bottom-24 / md:bottom-28,
    // which the lifted button would now cover. The container lifts the card with it: a child
    // selector puts the card's bottom at least 2 rem above the pill's top, as at rest (4 rem -> 6 rem).
    const pillTop = floatBottom + rem(sosButtons()[0], 'h-');
    const lift = [...float.classList]
      .map((c) => /^\[&_\[data-testid=sos-hold-card\]\]:bottom-\[(\d+(?:\.\d+)?)rem\]$/.exec(c))
      .find(Boolean);
    expect(lift).toBeTruthy();
    expect(Number(lift[1])).toBeGreaterThanOrEqual(pillTop + 2);
  });

  it('leaves its hold card where SosTrigger puts it when not navigating (wide screen: always floats)', () => {
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    onTheMap();
    const float = screen.getByTestId('sos-float');
    expect(float.className).toMatch(/fixed left-4 bottom-4 md:bottom-6 md:left-\[23rem\]/);
    expect([...float.classList].some((c) => c.includes('sos-hold-card'))).toBe(false);
  });

  // On arrival the summary card goes and the arrival panel takes the space above the bottom edge
  // (bottom-24 and up), so the button drops back to the bottom instead of standing on the panel.
  it('drops back to the bottom on arrival, below the arrival panel', async () => {
    straightRoute.on = true;
    onTestFinished(() => { straightRoute.on = false; });
    const fixes = [];
    navigator.geolocation.watchPosition = vi.fn((ok) => { fixes.push(ok); return 1; });
    navigator.geolocation.getCurrentPosition = vi.fn((ok) => fixes.push(ok));
    const at = (lat, lng) => act(async () => {
      fixes.forEach((ok) => ok({ coords: { latitude: lat, longitude: lng, accuracy: 5, heading: null, speed: 0 }, timestamp: Date.now() }));
    });
    await startNavigating();
    const target = screen.getByText(/Walking to/).querySelector('strong').textContent;
    const { SRM_MASTER_DATABASE } = await import('../src/srmDatabase.js');
    const b = SRM_MASTER_DATABASE.find((x) => x.name === target);
    await at(b.lat + 0.002, b.lng); // ~220 m away: a route is drawn and the trip card is up
    expect(screen.getByTestId('sos-float').classList.contains('bottom-4')).toBe(false);
    for (let i = 0; i < 15; i += 1) await at(b.lat, b.lng); // there (fixes are smoothed, so several)
    await waitFor(() => expect(screen.getByTestId('arrival-panel')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('navigation-summary-card')).toBeNull()); // after its exit
    expect(screen.getByTestId('sos-float').classList.contains('bottom-4')).toBe(true);
  });

  it('goes back into the tab bar when the route ends', async () => {
    await startNavigating();
    fireEvent.click(screen.getAllByRole('button', { name: 'End route' })[0]);
    await waitFor(() => expect(screen.queryByTestId('turn-instruction-card')).toBeNull());
    expect(screen.queryByTestId('sos-float')).toBeNull();
    expect(sosButtons()).toHaveLength(1);
    expect(tabBar().contains(sosButtons()[0])).toBe(true);
  });
});

describe('the Firebase client config', () => {
  it('falls back to the public client config, so a build without VITE_FIREBASE_* still signs in', () => {
    const firebase = readFileSync(`${process.cwd()}/src/firebase.js`, 'utf8');
    expect(firebase).toMatch(/apiKey: import\.meta\.env\.VITE_FIREBASE_API_KEY \|\| "AIza[\w-]+"/);
    expect(firebase).not.toMatch(/\|\| ""/);
  });
});
