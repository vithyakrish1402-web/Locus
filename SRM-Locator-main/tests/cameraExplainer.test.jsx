// @vitest-environment jsdom
//
// The camera explainer, "Allow the camera for AR Scan", through the real App.jsx: shown before
// AR Scan opens only until the camera has been allowed. Continue goes on to AR Scan's own
// start screen (whose tap starts the camera and compass); Not now leaves AR Scan closed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

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
const { CAMERA_EXPLAINER, AR_START } = await import('../src/copy/permissions.js');
const { CAMERA_ALLOWED_KEY } = await import('../src/utils/cameraPermission.js');

const onTheMap = async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
  await act(async () => {}); // the Permissions API answer, if any
};
const openArScan = () => fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Scan' }));
const explainer = () => screen.queryByRole('dialog', { name: CAMERA_EXPLAINER.title });
const arStart = () => screen.queryByTestId('ar-start');

let getUserMedia;

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  try { localStorage.clear(); localStorage.setItem('locus.locationAllowed', '1'); } catch { /* no storage here */ }
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
  getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete navigator.geolocation;
  delete navigator.mediaDevices;
  delete navigator.permissions;
});

describe('the camera explainer', () => {
  it('shows before AR Scan the first time, with AR Scan not yet open', async () => {
    await onTheMap();
    openArScan();
    const sheet = explainer();
    expect(sheet).toBeTruthy();
    expect(sheet.textContent).toContain(CAMERA_EXPLAINER.body);
    expect(arStart()).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("Continue goes on to AR Scan's own start screen, which starts the camera", async () => {
    await onTheMap();
    openArScan();
    fireEvent.click(within(explainer()).getByRole('button', { name: CAMERA_EXPLAINER.continue }));
    await waitFor(() => expect(arStart()).toBeTruthy());
    expect(getUserMedia).not.toHaveBeenCalled(); // not until that screen's tap
    await act(async () => fireEvent.click(screen.getByRole('button', { name: AR_START.start })));
    expect(getUserMedia).toHaveBeenCalled();
  });

  it('Not now leaves AR Scan closed, and it asks again next time', async () => {
    await onTheMap();
    openArScan();
    fireEvent.click(within(explainer()).getByRole('button', { name: CAMERA_EXPLAINER.notNow }));
    await waitFor(() => expect(explainer()).toBeNull());
    expect(arStart()).toBeNull();
    openArScan();
    expect(explainer()).toBeTruthy();
  });

  it('asks again next time if AR Scan was left before the camera started', async () => {
    await onTheMap();
    openArScan();
    fireEvent.click(within(explainer()).getByRole('button', { name: CAMERA_EXPLAINER.continue }));
    fireEvent.click(await screen.findByRole('button', { name: AR_START.cancel }));
    await waitFor(() => expect(arStart()).toBeNull());
    openArScan();
    expect(explainer()).toBeTruthy();
  });

  it('stops showing once the camera has started for AR Scan', async () => {
    await onTheMap();
    openArScan();
    fireEvent.click(within(explainer()).getByRole('button', { name: CAMERA_EXPLAINER.continue }));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: AR_START.start })));
    expect(localStorage.getItem(CAMERA_ALLOWED_KEY)).toBe('1');
    cleanup();

    await onTheMap();
    openArScan();
    expect(explainer()).toBeNull();
    expect(arStart()).toBeTruthy();
  });

  it('a camera that never started (refused) does not count as allowed', async () => {
    getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
    await onTheMap();
    openArScan();
    fireEvent.click(within(explainer()).getByRole('button', { name: CAMERA_EXPLAINER.continue }));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: AR_START.start })));
    expect(localStorage.getItem(CAMERA_ALLOWED_KEY)).toBeNull();
  });

  it("doesn't show when the phone says the camera is already allowed", async () => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: 'granted' })) },
    });
    await onTheMap();
    openArScan();
    expect(explainer()).toBeNull();
    expect(arStart()).toBeTruthy();
  });

  it('shows when the phone says the camera is not allowed yet', async () => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: 'prompt' })) },
    });
    await onTheMap();
    openArScan();
    expect(explainer()).toBeTruthy();
  });
});
