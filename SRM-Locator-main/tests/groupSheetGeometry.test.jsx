// @vitest-environment jsdom
//
// The group panel on a phone (v1.1.69 recording): it stood on a hard-coded 64 px tab bar while the
// real one is taller, so the panel's bottom rows sat under the bar; at half and peek its list ran
// on below the screen with a fixed 8 rem of room, so the last rows could never be scrolled into
// sight; it let the map show through; and the meeting point button floated over it at every height.
// Through the real App.jsx. Only the app's edges are stubbed (socket, Firebase, native plugins, the maps, update hooks).
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

const HERE = { lat: 12.8230, lng: 80.0440 };
const TAB_BAR_PX = 114; // an 80 px bar plus a 34 px gesture bar inset
let code;
const bar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const sheet = () => screen.getByTestId('group-panel-list').closest('[data-height]');
const list = () => screen.getByTestId('group-panel-list');
const sized = (el, px) => Object.defineProperty(el, 'offsetHeight', { configurable: true, value: px });
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 892 });
  // jsdom lays nothing out: the tab bar is given its real height.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return this.getAttribute?.('aria-label') === 'Main' ? TAB_BAR_PX : 0; },
  });
  fakeSocket.handlers.clear();
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
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
  delete navigator.geolocation;
});

const inAGroup = async () => {
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  await screen.findByTestId('leaflet-stub');
};
/** The Group tab (peek), laid out as a 412 x 892 phone would. */
const groupAtPeek = async () => {
  await inAGroup();
  fireEvent.click(bar().getByRole('button', { name: 'Group' }));
  sized(sheet(), 752);
  sized(screen.getByTestId('group-panel-header'), 120);
  act(() => { window.dispatchEvent(new Event('resize')); });
};

describe('the group panel stands on the real tab bar', () => {
  it('the tab bar says how tall it is, and the panel stands on that', async () => {
    await groupAtPeek();
    expect(document.documentElement.style.getPropertyValue('--tab-bar-height')).toBe(`${TAB_BAR_PX}px`);
    expect(sheet().style.bottom).toBe('var(--tab-bar-height)');
    expect(sheet().className).not.toMatch(/bottom-16/);
  });
});

describe('the panel is opaque', () => {
  it('uses the solid surface, not the see-through glass', async () => {
    await groupAtPeek();
    expect(sheet().className).toContain('glass-solid');
    expect(sheet().className).not.toContain('glass-floating');
  });
});

describe('the last rows can always be scrolled into sight', () => {
  it('the list ends a tab bar and 2 rem above its end, and a spacer as tall as the slide-down, at every height', async () => {
    await groupAtPeek();
    const spacer = () => list().lastElementChild;
    expect(sheet().dataset.height).toBe('peek');
    expect(list().style.paddingBottom).toBe('calc(var(--tab-bar-height) + 2rem)');
    const atPeek = parseFloat(spacer().style.height);
    expect(atPeek).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('group-panel-header')); // peek -> half
    expect(sheet().dataset.height).toBe('half');
    expect(list().style.paddingBottom).toBe('calc(var(--tab-bar-height) + 2rem)');
    const atHalf = parseFloat(spacer().style.height);
    expect(atHalf).toBeGreaterThan(0);
    expect(atHalf).toBeLessThan(atPeek);

    fireEvent.wheel(list(), { deltaY: 40 }); // half -> full
    expect(sheet().dataset.height).toBe('full');
    expect(list().style.paddingBottom).toBe('calc(var(--tab-bar-height) + 2rem)');
  });
});

describe('the meeting point button and the panel', () => {
  it('shows at peek, hides at half and full, and returns when the panel closes', async () => {
    await groupAtPeek();
    expect(sheet().dataset.height).toBe('peek');
    expect(screen.getByTestId('meeting-point-button')).toBeTruthy();

    fireEvent.click(screen.getByTestId('group-panel-header')); // half
    expect(screen.queryByTestId('meeting-point-button')).toBeNull();

    fireEvent.wheel(list(), { deltaY: 40 }); // full
    expect(screen.queryByTestId('meeting-point-button')).toBeNull();

    fireEvent.click(screen.getByTestId('group-panel-header')); // a tap at full closes it
    expect(screen.getByTestId('meeting-point-button')).toBeTruthy();
  });
});
