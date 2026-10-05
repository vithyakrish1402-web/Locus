// @vitest-environment jsdom
//
// Settings -> AR Scan quality, AR Scan's main fidelity dial, and AR Scan parts (under More),
// each part's own setting: selectable, showing which option is chosen, and reaching AR Scan.
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
const { SETTINGS } = await import('../src/copy/settings.js');

beforeEach(() => {
  // The camera was allowed before, so AR Scan opens without its explainer (see cameraExplainer.test.jsx).
  try { localStorage.setItem('locus.cameraAllowed', '1'); } catch { /* no storage */ }
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

// Signed in -> lobby -> Create group -> the map -> Settings (the gear).
const openSettings = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
  fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
};
const group = (name) => within(screen.getByRole('radiogroup', { name }));
const choice = (groupName, label) => group(groupName).getByRole('radio', { name: label });
const chosen = (groupName) => group(groupName).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent);
const Q = SETTINGS.arQuality;
const QO = SETTINGS.arQualityOptions;
const PART = SETTINGS.arPartNames;
const PO = SETTINGS.arPartOptions;

describe('AR Scan quality', () => {
  it('sits after the location refresh rate, with Standard chosen by default', () => {
    openSettings();
    const quality = screen.getByRole('radiogroup', { name: Q });
    const refresh = screen.getByRole('radiogroup', { name: SETTINGS.refresh });
    expect(refresh.compareDocumentPosition(quality) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chosen(Q)).toEqual([QO.standard]);
    expect(screen.getByText(SETTINGS.arQualityHelp)).toBeTruthy();
  });

  it('chooses exactly one option at a time, without touching the refresh rate', () => {
    openSettings();
    for (const pick of ['efficient', 'realistic', 'standard']) {
      fireEvent.click(choice(Q, QO[pick]));
      expect(chosen(Q)).toEqual([QO[pick]]);
      expect(chosen(SETTINGS.refresh)[0]).toMatch(new RegExp(`^${SETTINGS.refreshOptions.standard.label}`));
    }
  });
});

describe('AR Scan quality reaches AR Scan', () => {
  it('opens AR Scan with the chosen quality', async () => {
    openSettings();
    fireEvent.click(choice(Q, QO.efficient));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /SCAN/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
    expect(screen.getByTestId('ar-arrow-ring').dataset.fidelity).toBe('efficient');
  });
});

// Stage 6's per-part overrides, now under Settings' "More": one row per AR Scan part.
describe('AR Scan parts', () => {
  const optionsOf = (part) => group(PART[part]).getAllByRole('radio').map((r) => r.textContent);

  it('sit after AR Scan quality, one row per part, each with only its own options', () => {
    openSettings();
    const quality = screen.getByRole('radiogroup', { name: Q });
    const parts = screen.getByText(SETTINGS.arParts);
    expect(quality.compareDocumentPosition(parts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(optionsOf('tags')).toEqual([PO.auto, PO.off]);
    expect(optionsOf('roadLine')).toEqual([PO.auto, PO.off, PO.efficient, PO.realistic]);
    expect(optionsOf('arrow')).toEqual([PO.auto, PO.efficient, PO.realistic]);
  });

  it('start with every part on Auto', () => {
    openSettings();
    for (const part of ['tags', 'roadLine', 'arrow']) expect(chosen(PART[part])).toEqual([PO.auto]);
  });

  it('set one part at a time, leaving the others and the main dial alone', () => {
    openSettings();
    fireEvent.click(choice(PART.roadLine, PO.off));
    expect(chosen(PART.roadLine)).toEqual([PO.off]);
    expect(chosen(PART.tags)).toEqual([PO.auto]);
    expect(chosen(PART.arrow)).toEqual([PO.auto]);
    expect(chosen(Q)).toEqual([QO.standard]);
    fireEvent.click(choice(PART.arrow, PO.realistic));
    fireEvent.click(choice(PART.tags, PO.off));
    expect(chosen(PART.roadLine)).toEqual([PO.off]); // an earlier choice survives a later one
    expect(chosen(PART.arrow)).toEqual([PO.realistic]);
    expect(chosen(PART.tags)).toEqual([PO.off]);
    fireEvent.click(choice(PART.roadLine, PO.auto));
    expect(chosen(PART.roadLine)).toEqual([PO.auto]);
    expect(chosen(PART.arrow)).toEqual([PO.realistic]);
  });

  it('reach AR Scan: an arrow override beats the main dial', async () => {
    openSettings();
    fireEvent.click(choice(Q, QO.realistic));
    fireEvent.click(choice(PART.arrow, PO.efficient));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /SCAN/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
    expect(screen.getByTestId('ar-arrow-ring').dataset.fidelity).toBe('efficient');
    expect(screen.getByTestId('ar-arrow-3d')).toBeTruthy();
  });
});
