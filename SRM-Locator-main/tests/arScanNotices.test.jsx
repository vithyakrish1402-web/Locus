// @vitest-environment jsdom
//
// Notices posted while AR Scan is open. AR Scan is a full-screen layer, and the notice feed
// used to sit underneath it, so its own notices (an ALIGN result or refusal, "compass access
// denied") were posted, drawn behind the camera view, and timed out unseen.
//
// Now the feed is drawn over AR Scan, and while AR Scan is open it starts below AR's header,
// so a notice never covers or moves the ALIGN, RESET and close buttons. An incoming SOS
// still draws over everything, the feed included, and an update gate stays over the feed.
//
// Renders the real App.jsx; only the socket transport, Firebase, native plugins, maps and
// the update hooks are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';

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
    timeout: () => ({ emit: vi.fn() }),
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
const { notify, __resetNotifications } = await import('../src/utils/notify.js');
const { LAYER } = await import('../src/utils/layers.js');
const { TOP_OVER_AR_SCAN } = await import('../src/components/CommsFeed.jsx');
const { default: UpdateModal } = await import('../src/components/UpdateModal.jsx');
const { UpdateStatus } = await import('../src/hooks/useAppUpdate.js');

const z = (el) => Number(el.style.zIndex);
const feed = () => screen.getByTestId('comms-feed');
// AR Scan's root: its permission screen, which is where it opens.
const arScan = () => screen.getByRole('button', { name: /^Start AR Scan$/ }).closest('div.fixed');

const onMapWithArScanOpen = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Scan' }));
};

beforeEach(() => {
  // The camera was allowed before, so AR Scan opens without its explainer (see cameraExplainer.test.jsx).
  try { localStorage.setItem('locus.cameraAllowed', '1'); } catch { /* no storage */ }
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  __resetNotifications();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  __resetNotifications();
  vi.restoreAllMocks();
  delete navigator.geolocation;
});

describe('notices during AR Scan', () => {
  it('are drawn over AR Scan, below its header buttons', () => {
    onMapWithArScanOpen();
    act(() => { notify.warning('Point at a building first, with its label in the middle of the view.'); });

    expect(within(feed()).getByText(/Point at a building first/)).toBeTruthy();
    expect(z(feed())).toBeGreaterThan(z(arScan()));
    expect(feed().style.top).toBe(TOP_OVER_AR_SCAN);
  });

  it('go back to the top of the screen once AR Scan closes', () => {
    onMapWithArScanOpen();
    expect(feed().dataset.overArScan).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: /^Start AR Scan$/ })).toBeNull();
    // (jsdom can't parse the max()/env() top used outside AR Scan, so check the switch.)
    expect(feed().dataset.overArScan).toBeUndefined();
  });

  it('never cover an incoming SOS, which still draws over AR Scan too', () => {
    onMapWithArScanOpen();
    act(() => { notify.info('A squad member designated a rally point.'); });
    act(() => fakeSocket.receive('sos-received', { id: 's1', senderId: 'x', senderName: 'Bravo', lat: 12.82, lng: 80.04, timestamp: 1, ageMs: 0 }));

    const sos = screen.getByRole('alertdialog');
    expect(z(sos)).toBeGreaterThan(z(feed()));
    expect(z(sos)).toBeGreaterThan(z(arScan()));
  });

  it('stay under an update gate', () => {
    render(<UpdateModal update={{
      supported: true, status: UpdateStatus.AVAILABLE, manifest: { version: '1.2.0', notes: '' }, installedVersion: '1.1.0',
      progress: { percent: -1, loaded: 0, total: 0 }, error: null, mandatory: true, dismissed: false,
      check: vi.fn(), startDownload: vi.fn(), openInstallSettings: vi.fn(), dismiss: vi.fn(),
    }} />);
    expect(z(screen.getByRole('dialog'))).toBe(LAYER.update);
    expect(LAYER.update).toBeGreaterThan(LAYER.toast);
    expect(LAYER.emergency).toBeGreaterThan(LAYER.update);
  });
});
