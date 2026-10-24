// @vitest-environment jsdom
//
// Scrolling the members list never changes the group panel's section (item 4 of the 2026-10 bug
// batch): a long scroll drifts sideways, and any 60 px of that used to switch to Buildings. Only
// a clearly sideways swipe changes section now (utils/panelSwipe.js). Through the real App.jsx.
// Only the app's edges are stubbed (socket, Firebase, native plugins, the maps, update hooks).
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
// A stand-in for the free map that shows what App tells it: whether the dots are on, and a
// dot to tap.
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: (props) => (
    <div data-testid="leaflet-stub" data-dots={String(props.showBuildings)}>
      <button type="button" data-testid="stub-dot" onClick={() => props.onFocus({ lat: props.places[0].lat, lng: props.places[0].lng }, props.places[0])}>dot</button>
    </div>
  ),
}));
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
const { sectionSwipe, SWIPE_MIN_DX_PX } = await import('../src/utils/panelSwipe.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
let code;
const bravo = () => ({
  'sock-Bravo': { uid: 'u-Bravo', name: 'Bravo', roomCode: code, lat: HERE.lat + 0.001, lng: HERE.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now() },
});
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const currentTab = () => tabBar().getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.textContent;
// jsdom has no layout: say whether the screen is a phone's (the app asks matchMedia).
const screenIs = (phone) => {
  window.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
};
const dots = () => screen.getByTestId('leaflet-stub').getAttribute('data-dots');

const onTheMap = async ({ cameraKnown = true } = {}) => {
  if (cameraKnown) localStorage.setItem('locus.cameraAllowed', '1');
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  act(() => fakeSocket.receive('users-update', bravo()));
  await screen.findByTestId('leaflet-stub');
};

beforeEach(() => {
  screenIs(true);
  localStorage.clear();
  sessionStorage.clear();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
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

// `count` members other than you, all with a fix.
const crowd = (count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [
  `sock-${i}`,
  { uid: `u-${i}`, name: `Member ${i}`, roomCode: code, lat: HERE.lat + 0.0001 * i, lng: HERE.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now() },
]));
const panel = () => screen.getByTestId('group-panel-list').closest('[data-height]');
const list = () => screen.getByTestId('group-panel-list');
const section = () => (screen.getByRole('radio', { name: 'Members' }).getAttribute('aria-checked') === 'true' ? 'Members' : 'Buildings');
const touch = (from, to, { scrollBy = 0 } = {}) => {
  fireEvent.touchStart(list(), { touches: [{ clientX: from.x, clientY: from.y }] });
  list().scrollTop += scrollBy;
  fireEvent.touchEnd(list(), { changedTouches: [{ clientX: to.x, clientY: to.y }] });
};
const membersOpen = async (count) => {
  await onTheMap();
  act(() => fakeSocket.receive('users-update', crowd(count)));
  fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
  expect(section()).toBe('Members');
};

describe('sectionSwipe', () => {
  it('is a swipe only when clearly sideways and long enough', () => {
    expect(sectionSwipe({ x: 300, y: 400 }, { x: 200, y: 410 })).toBe('left');
    expect(sectionSwipe({ x: 100, y: 400 }, { x: 200, y: 390 })).toBe('right');
    expect(sectionSwipe({ x: 300, y: 400 }, { x: 300 - (SWIPE_MIN_DX_PX - 1), y: 400 })).toBeNull();
    // A scroll that drifted sideways by more than the old 60 px threshold.
    expect(sectionSwipe({ x: 100, y: 600 }, { x: 180, y: 200 })).toBeNull();
    expect(sectionSwipe({ x: 300, y: 600 }, { x: 220, y: 200 })).toBeNull();
    // Sideways but the list scrolled: a scroll.
    expect(sectionSwipe({ x: 300, y: 400 }, { x: 150, y: 420 }, true)).toBeNull();
    expect(sectionSwipe(null, { x: 0, y: 0 })).toBeNull();
    expect(sectionSwipe({ x: NaN, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe('the members list', () => {
  for (const count of [1, 16]) {
    it(`scrolls without changing section, with ${count} member(s)`, async () => {
      await membersOpen(count);
      // A long thumb scroll down the list that drifts right, then one that drifts left.
      touch({ x: 120, y: 700 }, { x: 200, y: 250 }, { scrollBy: 300 });
      expect(section()).toBe('Members');
      touch({ x: 260, y: 700 }, { x: 180, y: 250 }, { scrollBy: 300 });
      expect(section()).toBe('Members');
      // Even a flick at the end of the list, where it no longer scrolls.
      touch({ x: 120, y: 700 }, { x: 190, y: 600 });
      expect(section()).toBe('Members');
    });
  }

  it('still changes section on a clearly sideways swipe', async () => {
    await membersOpen(16);
    touch({ x: 100, y: 500 }, { x: 260, y: 520 });
    expect(section()).toBe('Buildings');
    touch({ x: 300, y: 500 }, { x: 120, y: 490 });
    expect(section()).toBe('Members');
    expect(panel()).toBeTruthy();
  });

  it('cannot hand a scroll on to the page behind (overscroll stays in the list)', async () => {
    await membersOpen(16);
    expect(list().className).toContain('overscroll-contain');
  });
});
