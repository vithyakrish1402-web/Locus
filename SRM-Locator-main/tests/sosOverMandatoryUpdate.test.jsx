// @vitest-environment jsdom
//
// An incoming SOS must reach the screen even while a [MANDATORY] update is gating the
// app. The gate is an early return at the top of App's render, and the overlay used to
// live only in the final (map) branch — so an SOS that arrived while the gate was up was
// queued, never drawn, and its klaxon never sounded. SosOverlay (z-10002) and
// UpdateModal (z-10000) were already stacked for "a distress beacon outranks a version
// bump"; the render tree just never let the two coexist.
//
// Renders the real App.jsx: only its edges (socket transport, Firebase, native plugins,
// the two update hooks) are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

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
    // Server -> client delivery, as socket.io would do it.
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
  };
});

const updateState = vi.hoisted(() => ({ mandatory: true }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: () => () => {},
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
vi.mock('../src/hooks/useLiveUpdate.js', () => ({
  useLiveUpdate: () => ({ status: 'idle', supported: false, restart: vi.fn() }),
}));
vi.mock('../src/hooks/useAppUpdate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAppUpdate: () => ({
      supported: true,
      status: actual.UpdateStatus.AVAILABLE,
      manifest: {
        version: '9.0.0',
        tag: 'v9.0.0',
        apkUrl: 'https://example.test/locus.apk',
        apkSize: 1024,
        sha256: 'a'.repeat(64),
        mandatory: updateState.mandatory,
        prerelease: false,
        notes: 'Required update.',
      },
      installedVersion: '1.0.0',
      progress: { percent: -1, loaded: 0, total: 0 },
      error: null,
      mandatory: updateState.mandatory,
      dismissed: false,
      check: vi.fn(),
      startDownload: vi.fn(),
      openInstallSettings: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

// jsdom has no Web Audio; the overlay's klaxon needs just enough to start and stop.
class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.closed = false;
    FakeAudioContext.instances.push(this);
  }
  createOscillator() {
    return { type: '', frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {} }, connect() {}, disconnect() {} };
  }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
}
FakeAudioContext.instances = [];

const { default: App } = await import('../src/App.jsx');

const SOS = {
  id: 'sos-1',
  senderId: 'bravo-socket',
  senderName: 'Bravo',
  lat: 12.8231,
  lng: 80.0442,
  ageMs: 0,
};

beforeEach(() => {
  updateState.mandatory = true;
  fakeSocket.emit.mockClear();
  FakeAudioContext.instances = [];
  window.AudioContext = FakeAudioContext;
});

afterEach(() => {
  cleanup();
  delete window.AudioContext;
});

describe('incoming SOS while a mandatory update gates the app', () => {
  it('the gate is up and nothing else of the app is', () => {
    render(<App />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('draws the SOS overlay on top of the gate, with sender and coordinates', () => {
    render(<App />);
    act(() => fakeSocket.receive('sos-received', SOS));

    const sos = screen.getByRole('alertdialog');
    expect(sos.textContent).toContain('BRAVO');
    expect(sos.textContent).toContain('12.8231, 80.0442');
    // The gate is still there underneath: acknowledging an SOS must not be a way
    // around a required update.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('sounds the klaxon, and ACKNOWLEDGE silences it and returns to the gate', () => {
    render(<App />);
    act(() => fakeSocket.receive('sos-received', SOS));
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].closed).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));

    expect(fakeSocket.emit).toHaveBeenCalledWith('sos-ack', { id: 'sos-1' });
    expect(FakeAudioContext.instances[0].closed).toBe(true);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
