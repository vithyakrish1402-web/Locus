// @vitest-environment jsdom
//
// The JS-only update strip must be offered on every screen, not just the map. It used to
// be rendered by the map screen alone, so a phone in the lobby (or on sign-in, the guide,
// or the boot screen) had a downloaded, verified bundle waiting and was never told. Found
// on a real device while verifying js-1.0.4.
//
// Renders the real App.jsx; only the socket, Firebase, native plugins, maps and the two
// update hooks are stubbed. The live-update hook's state is set per test.
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

// `user`: who onAuthStateChanged reports. `pending`: never report, so the app stays on
// its boot screen (authLoading).
const authState = vi.hoisted(() => ({ user: null, pending: false }));
const live = vi.hoisted(() => ({ current: null }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    if (!authState.pending) callback(authState.user);
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
vi.mock('../src/hooks/useLiveUpdate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useLiveUpdate: () => live.current };
});
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
const { LiveUpdateStatus } = await import('../src/hooks/useLiveUpdate.js');

const ready = () => ({
  status: LiveUpdateStatus.READY,
  supported: true,
  visible: true,
  manifest: { version: '1.0.5', minNative: '1.0.0' },
  applyNow: vi.fn(),
  dismiss: vi.fn(),
});

// The strip is one of possibly several live regions (the boot screen's loader is one too),
// so it is found by what it says rather than by being the only role="status".
const strip = () =>
  screen.queryAllByRole('status').find((el) => /UPDATE (READY|BLOCKED)/.test(el.textContent)) ?? null;

// The guide opens on an animated intro; its skip button goes straight to the guide.
const skipIntro = async () => {
  fireEvent.click(screen.getByRole('button', { name: /skip intro/i }));
  await screen.findByRole('button', { name: /initialize secure link/i });
};

beforeEach(() => {
  authState.user = { uid: 'u-self', displayName: 'Alpha', photoURL: null };
  authState.pending = false;
  live.current = ready();
  // jsdom has neither: the map starts GPS tracking once a squad is granted, and the
  // guide's scroll animations observe intersections. Never-firing stand-ins are enough.
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
});

afterEach(() => {
  cleanup();
  delete navigator.geolocation;
  delete globalThis.IntersectionObserver;
});

describe('the JS update strip is offered on every screen', () => {
  it('on the boot screen, while sign-in is still being restored', () => {
    authState.pending = true;
    render(<App />);
    expect(screen.getByText('INITIALIZING_SECURE_LINK...')).toBeTruthy();
    expect(strip()).toBeTruthy();
  });

  it('on the guide, from its intro onwards', async () => {
    authState.user = null;
    render(<App />);
    expect(screen.getByRole('button', { name: /skip intro/i })).toBeTruthy();
    expect(strip()).toBeTruthy();
    await skipIntro();
    expect(screen.getByRole('button', { name: /initialize secure link/i })).toBeTruthy();
    expect(strip()).toBeTruthy();
  });

  it('on sign-in', async () => {
    authState.user = null;
    render(<App />);
    await skipIntro();
    fireEvent.click(screen.getByRole('button', { name: /initialize secure link/i }));
    expect(screen.queryByText('SECURE_CHANNEL')).toBeNull();
    expect(strip()).toBeTruthy();
  });

  it('in the squad lobby - where the device check found it missing', () => {
    render(<App />);
    expect(screen.getByText('SECURE_CHANNEL')).toBeTruthy();
    expect(strip()).toBeTruthy();
    expect(screen.getByText('Version 1.0.5 is ready. Restart to use it.')).toBeTruthy();
  });

  it('on the map, exactly once', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
    expect(screen.queryByText('SECURE_CHANNEL')).toBeNull(); // on the map now
    expect(screen.getAllByText('Version 1.0.5 is ready. Restart to use it.')).toHaveLength(1);
  });
});

describe('where the strip sits', () => {
  // On the phone's map it was drawn over the bottom tab bar and the SOS button (found on a
  // device). There it now sits above both; elsewhere, at the bottom.
  const raised = () => strip().className.includes('bottom-[calc(10.5rem');

  it('sits at the very bottom in the lobby, where there is no tab bar', () => {
    render(<App />);
    expect(raised()).toBe(false);
  });

  it('sits above the tab bar on the map', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
    expect(raised()).toBe(true);
  });
});

describe('when the strip steps aside', () => {
  // Found on the phone: with the keyboard up the strip rode over CONNECT TO SQUAD, and on
  // the map it covered the roster whenever the squad sheet was open.
  it('hides while a text field has focus, and returns after', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
    const input = screen.getByPlaceholderText('E.G. KTR7X9');
    expect(strip()).toBeTruthy();
    act(() => { input.focus(); });
    expect(strip()).toBeNull();
    await act(async () => { input.blur(); await new Promise((r) => setTimeout(r, 0)); });
    expect(strip()).toBeTruthy();
  });

  it('comes back when the focused field is removed without a blur (Enter joining a squad)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
    const input = screen.getByPlaceholderText('E.G. KTR7X9');
    act(() => { input.focus(); });
    expect(strip()).toBeNull();
    // What Chrome does when a focused element leaves the page: nothing. No blur, no focusout.
    const ghost = document.createElement('input');
    document.body.appendChild(ghost);
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => ghost });
    ghost.remove();
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
      expect(strip()).toBeTruthy();
    } finally {
      delete document.activeElement;
    }
  });

  it('hides on a phone while the squad sheet is open, and returns on the map', () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
      act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
      expect(strip()).toBeTruthy();
      const bar = screen.getByRole('navigation', { name: 'Main' });
      fireEvent.click(within(bar).getByRole('button', { name: /SQUAD/ }));
      expect(strip()).toBeNull();
      fireEvent.click(within(bar).getByRole('button', { name: /GRID/ }));
      expect(strip()).toBeTruthy();
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });
});

describe('the strip itself', () => {
  it('says READY, not APPLIED, and RESTART applies it', () => {
    render(<App />);
    expect(screen.getByText('UPDATE READY')).toBeTruthy();
    expect(screen.queryByText('UPDATE APPLIED')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(live.current.applyNow).toHaveBeenCalledTimes(1);
  });

  it('shows a blocked bundle outside the map too', () => {
    live.current = { ...ready(), status: LiveUpdateStatus.BLOCKED, manifest: { version: '1.0.5', minNative: '1.1.0' } };
    render(<App />);
    expect(screen.getByText('UPDATE BLOCKED')).toBeTruthy();
    expect(screen.getByText(/needs app version 1\.1\.0 or newer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
  });

  it('is absent when nothing is staged', () => {
    live.current = { ...ready(), status: LiveUpdateStatus.IDLE, visible: false };
    render(<App />);
    expect(strip()).toBeNull();
  });
});
