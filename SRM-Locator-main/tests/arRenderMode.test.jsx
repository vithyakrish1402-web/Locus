// @vitest-environment jsdom
//
// SYS_CONFIG -> AR_RENDER_MODE, AR Scan's main fidelity dial, and AR_FEATURE_OVERRIDES,
// each feature's own setting under it: selectable, showing which option is active, and
// reaching AR Scan.
//
// Renders the real App.jsx; only the socket, Firebase, native plugins, maps and the update
// hooks are stubbed (same harness as tabBarAndBanners.test.jsx).
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
    emit: () => {},
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
  useLiveUpdate: () => ({ status: 'idle', supported: false, visible: false, applyNow: vi.fn(), dismiss: vi.fn() }),
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

beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn(() => {}),
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

// Signed in -> lobby -> INITIALIZE -> the map -> SYS_CONFIG.
const openSettings = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
  fireEvent.click(screen.getByTitle('System Configuration (SYS_CONFIG)'));
};
const option = (name) => screen.getByRole('button', { name: new RegExp(`^${name}$`) });
const isActive = (name) => !option(name).className.includes('text-zinc-500');

describe('AR_RENDER_MODE', () => {
  it('sits after the polling rate, with STANDARD selected by default', () => {
    openSettings();
    const label = screen.getByText('AR_RENDER_MODE');
    const polling = screen.getByText('TELEMETRY_POLLING_RATE');
    expect(polling.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(isActive('STANDARD')).toBe(true);
    expect(isActive('EFFICIENT')).toBe(false);
    expect(isActive('REALISTIC')).toBe(false);
    expect(screen.getByText(/REALISTIC mode uses more battery/)).toBeTruthy();
  });

  it('selects exactly one option at a time, without touching the polling rate', () => {
    openSettings();
    for (const pick of ['EFFICIENT', 'REALISTIC', 'STANDARD']) {
      fireEvent.click(option(pick));
      for (const other of ['EFFICIENT', 'STANDARD', 'REALISTIC']) {
        expect(isActive(other)).toBe(other === pick);
      }
      expect(screen.getByRole('button', { name: /STANDARD \(5s\)/ }).className).not.toContain('text-zinc-500');
    }
  });
});

describe('AR_RENDER_MODE reaches AR Scan', () => {
  it('opens AR Scan with the selected mode', async () => {
    openSettings();
    fireEvent.click(option('EFFICIENT'));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /SCAN/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
    expect(screen.getByTestId('ar-arrow-ring').dataset.fidelity).toBe('efficient');
  });
});

// Stage 6: AR_FEATURE_OVERRIDES, one row per AR Scan feature under the main dial.
describe('AR_FEATURE_OVERRIDES', () => {
  const row = (label) => within(screen.getByRole('group', { name: label }));
  const optionsOf = (label) => row(label).getAllByRole('button').map((b) => b.textContent);
  const pressed = (label) => row(label).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

  it('sits after AR_RENDER_MODE, one row per feature, each with only its own options', () => {
    openSettings();
    const dial = screen.getByText('AR_RENDER_MODE');
    const block = screen.getByText('AR_FEATURE_OVERRIDES');
    expect(dial.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(optionsOf('AMBIENT_TAGS')).toEqual(['AUTO', 'OFF']);
    expect(optionsOf('ROAD_LINE')).toEqual(['AUTO', 'OFF', 'EFFICIENT', 'REALISTIC']);
    expect(optionsOf('ARROW')).toEqual(['AUTO', 'EFFICIENT', 'REALISTIC']);
  });

  it('starts with every feature on AUTO', () => {
    openSettings();
    for (const label of ['AMBIENT_TAGS', 'ROAD_LINE', 'ARROW']) expect(pressed(label)).toEqual(['AUTO']);
  });

  it('sets one feature at a time, leaving the others and the main dial alone', () => {
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'ROAD_LINE OFF' }));
    expect(pressed('ROAD_LINE')).toEqual(['OFF']);
    expect(pressed('AMBIENT_TAGS')).toEqual(['AUTO']);
    expect(pressed('ARROW')).toEqual(['AUTO']);
    expect(isActive('STANDARD')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'ARROW REALISTIC' }));
    fireEvent.click(screen.getByRole('button', { name: 'AMBIENT_TAGS OFF' }));
    expect(pressed('ROAD_LINE')).toEqual(['OFF']); // an earlier choice survives a later one
    expect(pressed('ARROW')).toEqual(['REALISTIC']);
    expect(pressed('AMBIENT_TAGS')).toEqual(['OFF']);
    fireEvent.click(screen.getByRole('button', { name: 'ROAD_LINE AUTO' }));
    expect(pressed('ROAD_LINE')).toEqual(['AUTO']);
    expect(pressed('ARROW')).toEqual(['REALISTIC']);
  });

  it('reaches AR Scan: an arrow override beats the main dial', async () => {
    openSettings();
    fireEvent.click(option('REALISTIC'));
    fireEvent.click(screen.getByRole('button', { name: 'ARROW EFFICIENT' }));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /SCAN/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
    expect(screen.getByTestId('ar-arrow-ring').dataset.fidelity).toBe('efficient');
    expect(screen.getByTestId('ar-arrow-3d')).toBeTruthy();
  });
});
