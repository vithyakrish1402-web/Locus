// @vitest-environment jsdom
//
// The guide, "How LOCUS works" (redesign P11): five steps, Skip and Get started, shown once
// on first run before sign-in (remembered on the phone), and always from Settings › About.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

const authState = vi.hoisted(() => ({ user: null }));
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
    callback(authState.user);
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

MotionGlobalConfig.skipAnimations = true;

const { default: App } = await import('../src/App.jsx');
const { default: Guide } = await import('../src/components/guide/Guide.jsx');
const { GUIDE } = await import('../src/copy/guide.js');
const { SETTINGS } = await import('../src/copy/settings.js');
const { SIGN_IN } = await import('../src/copy/access.js');
const { GUIDE_SEEN_KEY } = await import('../src/utils/guideSeen.js');

const guide = () => screen.queryByTestId('guide');
const heading = () => within(guide()).getByRole('heading', { level: 1 }).textContent;

beforeEach(() => {
  authState.user = null;
  fakeSocket.handlers.clear();
  try { localStorage.clear(); localStorage.setItem('locus.locationAllowed', '1'); } catch { /* no storage here */ }
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

describe('the guide itself', () => {
  it('has five steps, Next through them, and Get started on the last', async () => {
    const onDone = vi.fn();
    render(<Guide onDone={onDone} />);
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId('guide-progress').textContent).toBe(GUIDE.progress(i + 1, 5));
      expect(heading()).toBe(GUIDE.steps[i].title);
      expect(screen.getByText(GUIDE.steps[i].body)).toBeTruthy();
      if (i < 4) fireEvent.click(screen.getByRole('button', { name: GUIDE.next }));
      await act(async () => {});
    }
    expect(screen.queryByRole('button', { name: GUIDE.skip })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: GUIDE.done }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Skip ends it from any step but the last', () => {
    const onDone = vi.fn();
    render(<Guide onDone={onDone} initialStep={2} />);
    fireEvent.click(screen.getByRole('button', { name: GUIDE.skip }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('mentions only real features: no vote, Google sign-in, area alerts or Stealth', () => {
    const all = GUIDE.steps.map((s) => `${s.title} ${s.body}`).join(' ');
    expect(all).not.toMatch(/vote|google|geofence|area alert|perimeter|stealth|invisible|nobody can see/i);
  });

  it('step 5 says the alert sends your current location whatever your sharing setting', () => {
    expect(GUIDE.steps[4].body).toMatch(/current location, whatever your sharing setting/);
  });
});

describe('the guide on first run', () => {
  it('shows before sign-in the first time, and Skip goes on to sign-in and is remembered', async () => {
    render(<App />);
    expect(guide()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: GUIDE.skip }));
    expect(await screen.findByText(SIGN_IN.title)).toBeTruthy();
    expect(localStorage.getItem(GUIDE_SEEN_KEY)).toBe('1');
  });

  it('Get started counts as seen too', async () => {
    render(<App />);
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: GUIDE.next }));
      await act(async () => {});
    }
    fireEvent.click(screen.getByRole('button', { name: GUIDE.done }));
    expect(await screen.findByText(SIGN_IN.title)).toBeTruthy();
    expect(localStorage.getItem(GUIDE_SEEN_KEY)).toBe('1');
  });

  it('does not show again once seen', () => {
    localStorage.setItem(GUIDE_SEEN_KEY, '1');
    render(<App />);
    expect(guide()).toBeNull();
    expect(screen.getByText(SIGN_IN.title)).toBeTruthy();
  });
});

describe('the guide from Settings', () => {
  it('How LOCUS works opens it over Settings, even once seen, and Get started closes it', async () => {
    localStorage.setItem(GUIDE_SEEN_KEY, '1');
    authState.user = { uid: 'u-self', displayName: 'Alpha', photoURL: null };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SETTINGS.howItWorks) }));
    expect(guide()).toBeTruthy();
    expect(Number(guide().style.zIndex)).toBeGreaterThan(Number(screen.getByTestId('settings').style.zIndex));
    fireEvent.click(screen.getByRole('button', { name: GUIDE.skip }));
    await waitFor(() => expect(guide()).toBeNull());
    expect(screen.getByTestId('settings')).toBeTruthy();
  });
});
