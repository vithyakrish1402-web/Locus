// @vitest-environment jsdom
//
// Settings covers the top bar and the bottom tab bar from the frame it opens to the frame it
// goes, through the real App.jsx. It fades in, and a fading element is its own stacking
// context: when the fade sat on a wrapper with no z-index of its own, Settings' z-index
// counted only inside that wrapper, and both bars drew over Settings until the fade ended.
// So the layer that sits beside the bars must be opaque, above them, and never faded itself.
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

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
const { SETTINGS_Z } = await import('../src/components/settings/SettingsScreen.jsx');

const onTheMap = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
};
const openSettings = () => fireEvent.click(within(screen.getByTestId('map-controls')).getByRole('button', { name: SETTINGS.open }));
const closeSettings = () => fireEvent.click(within(screen.getByTestId('settings')).getByRole('button', { name: SETTINGS.back }));

const topBar = () => screen.getByTestId('top-bar');
const bottomBar = () => screen.getByRole('navigation', { name: 'Main' });
const zClass = (el) => Number(/(?:^| )z-\[(\d+)\](?: |$)/.exec(el.className)?.[1] ?? NaN);
const faded = (el) => el.style.opacity !== '' && Number(el.style.opacity) < 1;

/** The element holding Settings that sits beside the bars: what decides which is on top. */
const settingsLayer = () => {
  const barsParent = topBar().parentElement;
  let el = screen.getByTestId('settings');
  while (el.parentElement && el.parentElement !== barsParent) el = el.parentElement;
  return el;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
});

describe('Settings over the top and bottom bars', () => {
  it('both bars share one parent with the Settings layer, so their z-indexes are compared directly', () => {
    onTheMap();
    openSettings();
    expect(bottomBar().parentElement).toBe(topBar().parentElement);
    expect(settingsLayer().parentElement).toBe(topBar().parentElement);
  });

  it('on its first frame, the layer beside the bars is above them, opaque, full screen and not faded', () => {
    onTheMap();
    openSettings();
    const layer = settingsLayer();
    expect(Number(layer.style.zIndex)).toBe(SETTINGS_Z);
    expect(Number(layer.style.zIndex)).toBeGreaterThan(Math.max(zClass(topBar()), zClass(bottomBar())));
    expect(layer.className).toMatch(/(^| )fixed( |$)/);
    expect(layer.className).toMatch(/(^| )inset-0( |$)/);
    expect(layer.className).toMatch(/(^| )bg-bg( |$)/);
    expect(faded(layer)).toBe(false);
  });

  it('is whole on its first frame: nothing in it is faded, in any theme', () => {
    onTheMap();
    openSettings();
    expect([...settingsLayer().querySelectorAll('*')].filter(faded)).toEqual([]);
  });

  it('has no part that starts invisible or waits on a delay (the stagger that read as a white flash)', () => {
    const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8');
    const rule = /\.settings-reveal \{[^}]*\}/.exec(css)[0];
    const keyframes = /@keyframes settings-reveal \{[^}]*\}[^}]*\}/.exec(css)[0];
    expect(rule).not.toMatch(/animation-delay/);
    expect(keyframes).not.toMatch(/opacity/);
  });

  it('covers the status bar with an opaque strip that is pinned, while the content scrolls under it', () => {
    onTheMap();
    openSettings();
    const screenEl = screen.getByTestId('settings');
    const cover = screen.getByTestId('settings-top-cover');
    expect(screenEl.firstElementChild).toBe(cover);
    expect(cover.className).toMatch(/(^| )top-cover( |$)/);
    expect(cover.className).toMatch(/(^| )sticky( |$)/);
    expect(cover.className).toMatch(/(^| )top-0( |$)/);
    // The strip is no longer padding on the scrolling box, which scrolled away with the content.
    expect(screenEl.style.paddingTop).toBe('');
    const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8');
    expect(css).toMatch(/--top-cover-height: max\(env\(safe-area-inset-top, 0px\), var\(--safe-area-inset-top, 0px\)\)/);
    expect(css).toMatch(/\.top-cover \{[^}]*background-color: var\(--color-bg\)/);
  });

  it('closing: the layer stays opaque and above the bars while the screen fades out, then goes', async () => {
    onTheMap();
    openSettings();
    await waitFor(() => expect([...settingsLayer().querySelectorAll('*')].some(faded)).toBe(false));
    const layer = settingsLayer();
    closeSettings();
    // Every frame until it goes: still there at first, never faded, never dropped below the bars.
    expect(layer.isConnected).toBe(true);
    const frames = [];
    const started = Date.now();
    while (layer.isConnected && Date.now() - started < 3000) {
      frames.push({ faded: faded(layer), z: Number(layer.style.zIndex), screenFaded: [...layer.querySelectorAll('*')].some(faded) });
      await act(() => new Promise((resolve) => setTimeout(resolve, 16)));
    }
    expect(layer.isConnected).toBe(false);
    expect(frames.some((f) => f.screenFaded)).toBe(true);
    expect(frames.filter((f) => f.faded || f.z !== SETTINGS_Z)).toEqual([]);
    expect(screen.queryByTestId('settings-layer')).toBeNull();
    expect(screen.queryByTestId('settings')).toBeNull();
    expect(topBar()).toBeTruthy();
    expect(bottomBar()).toBeTruthy();
  });

  it('opening and closing quickly, over and over, ends with Settings open, then fully gone', async () => {
    onTheMap();
    for (let i = 0; i < 4; i += 1) {
      openSettings();
      closeSettings();
    }
    openSettings();
    await waitFor(() => expect(screen.getAllByTestId('settings-layer')).toHaveLength(1));
    expect(faded(settingsLayer())).toBe(false);
    closeSettings();
    await waitFor(() => expect(screen.queryByTestId('settings-layer')).toBeNull());
  });
});
