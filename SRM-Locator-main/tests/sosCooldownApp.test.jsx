// @vitest-environment jsdom
//
// Item 5 of the 2026-10 bug batch in the real App.jsx: the server's answer to an SOS
// ('alert-result') is listened for, so an alert refused by the per-person cooldown takes back
// its "sent" notice and says how long is left; the Group Lead gets the SOS switch and the
// 1 / 3 / 5 minute cooldown (the server side is in alertGuard.e2e.test.js).
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
const { __resetNotifications, subscribe } = await import('../src/utils/notify.js');
const { SOS_REFUSED, SOS_SENT } = await import('../src/copy/emergency.js');
const { SOS_CONTROLS } = await import('../src/copy/group.js');
let feed = [];
subscribe((items) => { feed = items; });
const noticeUp = (text) => feed.some((n) => n.message === text || n.body === text);

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

// The Emergency button's full gesture (components/SosTrigger.jsx): hold 1.2 s, let go, hold 1.2 s again.
const sosButton = () => tabBar().getByRole('button', { name: /SOS beacon/ });
const holdTwice = async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  for (let i = 0; i < 2; i += 1) {
    fireEvent.pointerDown(sosButton(), { button: 0 });
    act(() => { vi.advanceTimersByTime(1200); });
    fireEvent.pointerUp(sosButton(), { button: 0 });
  }
  vi.useRealTimers();
};
const sent = () => fakeSocket.emit.mock.calls.filter(([e]) => e === 'sos-broadcast');
beforeEach(() => { __resetNotifications(); });

const settings = (over = {}) => ({
  roomCode: code, sosEnabled: true, pingEnabled: true, pingMuted: false,
  sosCooldownMs: 180000, sosCooldownPresetsMs: [60000, 180000, 300000], ...over,
});
const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event);

describe('an SOS the server refuses', () => {
  it('never says "sent", and says how long until another can go', async () => {
    await onTheMap();
    await holdTwice();
    expect(sent()).toHaveLength(1);
    // "Sent" waits for the server's answer (utils/sosOutbox.js), and this answer is a refusal.
    expect(noticeUp(SOS_SENT.title)).toBe(false);
    act(() => fakeSocket.receive('alert-result', { type: 'sos', roomCode: code, allowed: false, mode: 'blocked', reasonCode: 'COOLDOWN', retryAfterSec: 150 }));
    expect(noticeUp(SOS_SENT.title)).toBe(false);
    const refused = feed.find((n) => n.message === SOS_REFUSED.title);
    expect(refused).toMatchObject({ severity: 'warning' });
    expect(refused.body).toContain('2 min 30 s');
    expect(refused.body).toContain('112');
  });

  it('says so when the Group Lead has switched SOS off', async () => {
    await onTheMap();
    await holdTwice();
    act(() => fakeSocket.receive('alert-result', { type: 'sos', roomCode: code, allowed: false, mode: 'blocked', reasonCode: 'GROUP_DISABLED' }));
    expect(feed.find((n) => n.message === SOS_REFUSED.title)?.body).toBe(SOS_REFUSED.disabled);
  });

  it('leaves an accepted SOS, and a ping answer, alone', async () => {
    await onTheMap();
    await holdTwice();
    act(() => fakeSocket.receive('alert-result', { type: 'sos', roomCode: code, allowed: true, mode: 'allow', reasonCode: null }));
    act(() => fakeSocket.receive('alert-result', { type: 'ping', roomCode: code, allowed: false, mode: 'blocked', reasonCode: 'COOLDOWN', retryAfterSec: 5 }));
    expect(noticeUp(SOS_SENT.title)).toBe(true);
    expect(feed.some((n) => n.message === SOS_REFUSED.title)).toBe(false);
  });
});

describe("the Group Lead's SOS controls", () => {
  const openGroup = async () => {
    await onTheMap();
    act(() => fakeSocket.receive('group-settings', settings()));
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
  };

  it('switch SOS off and on for the group', async () => {
    await openGroup();
    const toggle = screen.getByRole('switch', { name: /Emergency alerts/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(emitted('set-group-settings').at(-1)[1]).toEqual({ roomCode: code, sosEnabled: false });
    act(() => fakeSocket.receive('group-settings', settings({ sosEnabled: false })));
    expect(screen.getByRole('switch', { name: /Emergency alerts/ }).getAttribute('aria-checked')).toBe('false');
    // No cooldown to choose while SOS is off.
    expect(screen.queryByRole('radio', { name: '1 min' })).toBeNull();
  });

  it("choose the time between one person's alerts from the presets", async () => {
    await openGroup();
    expect(screen.getByRole('radio', { name: '3 min' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '1 min' }));
    expect(emitted('set-group-settings').at(-1)[1]).toEqual({ roomCode: code, sosCooldownMs: 60000 });
  });

  it('say so when the server refuses the change', async () => {
    await openGroup();
    fireEvent.click(screen.getByRole('radio', { name: '5 min' }));
    const ack = emitted('set-group-settings').at(-1)[2];
    act(() => ack({ ok: false, reason: 'not-commander' }));
    expect(noticeUp(SOS_CONTROLS.notCommander)).toBe(true);
  });

  it('are not shown to a member', async () => {
    await onTheMap();
    act(() => fakeSocket.receive('demoted-to-member', { roomCode: code }));
    act(() => fakeSocket.receive('group-settings', settings()));
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    expect(screen.queryByTestId('sos-controls')).toBeNull();
  });
});
