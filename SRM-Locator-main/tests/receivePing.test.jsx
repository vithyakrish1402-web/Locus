// @vitest-environment jsdom
//
// Receiving a member ping. It used to be worded as an SOS ("CRITICAL SOS BEACON ...
// requires immediate assistance") and end in window.alert() — a blocking browser dialog
// that froze the whole app, the SOS klaxon included, until someone tapped OK. A ping is
// now a short, non-blocking notice in the HUD; the real SOS is SosOverlay's job.
//
// Renders the real App.jsx and walks it through the real lobby into a squad; only the
// socket transport, Firebase, native plugins, maps and the update hooks are stubbed.
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
  // Signed in straight away, as a remembered session would be.
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

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}, disconnect() {}, start() {}, stop() {},
    };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

const { default: App } = await import('../src/App.jsx');

// Signed in -> lobby -> JOIN SQUAD -> code -> CONNECT, as a person would.
const renderInSquad = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
  fireEvent.change(screen.getByPlaceholderText('E.G. KTR7X9'), { target: { value: 'KTR7X9' } });
  fireEvent.click(screen.getByRole('button', { name: /connect to squad/i }));
};

let alertSpy;

beforeEach(() => {
  // Only the timeouts: framer-motion's frame loop has to keep running on the real clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  window.AudioContext = FakeAudioContext;
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  alertSpy.mockRestore();
  delete window.AudioContext;
});

describe('receiving a member ping', () => {
  it('shows a non-blocking notice naming the sender — no alert(), no SOS wording', () => {
    renderInSquad();
    expect(fakeSocket.handlers.get('receive-ping')?.size).toBe(1);

    act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));

    expect(alertSpy).not.toHaveBeenCalled();
    const notice = screen.getByRole('status');
    expect(within(notice).getByText('BRAVO')).toBeTruthy();
    expect(notice.textContent).toMatch(/is pinging you/i);
    expect(notice.textContent).not.toMatch(/sos|assistance/i);
    // And it is not the SOS takeover either.
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('clears itself after a few seconds', async () => {
    renderInSquad();
    act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));
    expect(screen.getByRole('status')).toBeTruthy();

    act(() => vi.advanceTimersByTime(7000));
    await waitFor(() => expect(screen.queryByText(/is pinging you/i)).toBeNull());
  });

  it('copes with a ping that carries no name', () => {
    renderInSquad();
    act(() => fakeSocket.receive('receive-ping', {}));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/A SQUAD MEMBER/);
  });
});
