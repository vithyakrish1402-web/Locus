// @vitest-environment jsdom
//
// Item 8 of the 2026-10 bug batch in the real App.jsx: a ping plays natively at full alarm volume,
// and silently (still shown) with LOCUS's Do Not Disturb on; an SOS rings whatever it says.
// Settings has the Do Not Disturb switch and, on a phone, the row that lets an SOS ring through the
// phone's own Do Not Disturb; the app explains that once. The native bridge is a stand-in here.
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
const alerts = vi.hoisted(() => ({
  access: false,
  playAlertSound: vi.fn(() => Promise.resolve(true)),
  stopAlertSound: vi.fn(() => Promise.resolve()),
  shareInAppDnd: vi.fn(() => Promise.resolve()),
  openDndAccessSettings: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../src/utils/alertSound.js', () => ({
  ALERT_ALARM_VOLUME_FRACTION: 1.0,
  hasNativeAlertSound: () => true,
  playAlertSound: alerts.playAlertSound,
  stopAlertSound: alerts.stopAlertSound,
  shareInAppDnd: alerts.shareInAppDnd,
  dndAccessGranted: () => Promise.resolve(alerts.access),
  openDndAccessSettings: alerts.openDndAccessSettings,
}));
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
const dnd = await import('../src/utils/inAppDnd.js');
const { NOTICES } = await import('../src/copy/notices.js');
const { SETTINGS } = await import('../src/copy/settings.js');
let feed = [];
subscribe((items) => { feed = items; });

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

beforeEach(() => {
  __resetNotifications();
  dnd.__resetInAppDnd();
  alerts.access = false;
  Object.values(alerts).forEach((v) => v?.mockClear?.());
});
const pinged = () => act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));
const pingNoticeUp = () => feed.some((n) => n.message === NOTICES.ping('Bravo'));
const settle = () => act(async () => {});

describe('a ping', () => {
  it('plays at full alarm volume, natively', async () => {
    await onTheMap();
    pinged();
    expect(alerts.playAlertSound).toHaveBeenCalledWith('ping');
    expect(pingNoticeUp()).toBe(true);
  });

  it("is silent, but still shown, with LOCUS's Do Not Disturb on", async () => {
    dnd.setInAppDnd(true);
    await onTheMap();
    pinged();
    expect(alerts.playAlertSound).not.toHaveBeenCalled();
    expect(pingNoticeUp()).toBe(true);
  });
});

describe('an SOS', () => {
  it("rings with LOCUS's Do Not Disturb on: safety first", async () => {
    dnd.setInAppDnd(true);
    await onTheMap();
    act(() => fakeSocket.receive('sos-received', { id: 's1', senderId: 'sock-Bravo', senderName: 'Bravo', lat: HERE.lat, lng: HERE.lng, timestamp: Date.now(), ageMs: 0 }));
    expect(alerts.playAlertSound).toHaveBeenCalledWith('sos');
  });
});

describe('Settings', () => {
  const openSettings = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-layer');
    await settle();
  };

  it("has LOCUS's Do Not Disturb switch, kept on the phone", async () => {
    await onTheMap();
    await openSettings();
    const toggle = screen.getByRole('switch', { name: new RegExp(SETTINGS.inAppDnd) });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(dnd.isInAppDnd()).toBe(true);
    expect(alerts.shareInAppDnd).toHaveBeenLastCalledWith(true);
  });

  it("offers to let an SOS ring through the phone's Do Not Disturb, and opens that screen", async () => {
    await onTheMap();
    await openSettings();
    const row = await screen.findByTestId('dnd-access');
    expect(row.textContent).toContain(SETTINGS.dndAccessOff);
    fireEvent.click(within(row).getByRole('button', { name: SETTINGS.dndAccessAllow }));
    expect(alerts.openDndAccessSettings).toHaveBeenCalledTimes(1);
  });

  it('says so once it is allowed, with nothing to press', async () => {
    alerts.access = true;
    await onTheMap();
    await openSettings();
    const row = await screen.findByTestId('dnd-access');
    expect(row.textContent).toContain(SETTINGS.dndAccessOn);
    expect(within(row).queryByRole('button')).toBeNull();
  });
});

describe('the one-time word about Do Not Disturb access', () => {
  it('is shown once per phone, in a group, while access is not given; its tap opens the screen', async () => {
    await onTheMap();
    await settle();
    const notice = feed.find((n) => n.message === NOTICES.dndAccess.title);
    expect(notice).toBeTruthy();
    notice.onClick();
    expect(alerts.openDndAccessSettings).toHaveBeenCalledTimes(1);
    cleanup();
    __resetNotifications();
    // The app opened afresh on the same phone: only the note that it was said is kept.
    const said = localStorage.getItem('locus.dndExplained');
    localStorage.clear();
    localStorage.setItem('locus.dndExplained', said);
    await onTheMap();
    await settle();
    expect(feed.some((n) => n.message === NOTICES.dndAccess.title)).toBe(false);
  });

  it('is not shown when access is already given', async () => {
    alerts.access = true;
    await onTheMap();
    await settle();
    expect(feed.some((n) => n.message === NOTICES.dndAccess.title)).toBe(false);
  });
});
