// @vitest-environment jsdom
//
// The client half of handing a squad back to its returning Commander (the server half is
// in leaderSuccession.e2e.test.js).
//
// A member who stood in as Commander while the Commander was away was never told when
// the Commander came back. Their screen kept NODE_ACCESS, the join queue and the
// telemetry controls, and every decision they took on them was refused by the server.
// The server now sends 'demoted-to-member', and the screen goes back to a member's.
//
// Renders the real App.jsx against a fake socket.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';

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
    callback({ uid: 'u-self', displayName: 'Bravo', photoURL: null });
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
vi.mock('google-map-react', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({ default: () => <div data-testid="map" /> }));
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

const CODE = 'KTR7X9';
const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, ...args]) => args);
const nodeAccess = () => screen.queryByRole('button', { name: /NODE_ACCESS/ });
const openSquadTab = () => fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' })[0]);

// Joined as a member, then promoted to stand in while the Commander is away, with a
// stranger's request waiting and the join queue open.
const standInWithQueueOpen = async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
  fireEvent.change(screen.getByPlaceholderText('E.G. KTR7X9'), { target: { value: CODE } });
  fireEvent.click(screen.getByRole('button', { name: /connect to squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: CODE }));
  await screen.findByTestId('map');

  act(() => fakeSocket.receive('promoted-to-owner', { roomCode: CODE }));
  act(() => fakeSocket.receive('access-request', { targetId: 'stranger-socket', name: 'Stranger', photo: null, roomCode: CODE }));
  openSquadTab();
  fireEvent.click(await waitFor(() => { const b = nodeAccess(); expect(b).not.toBeNull(); return b; }));
  await screen.findByText('Stranger');
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete navigator.geolocation;
});

describe('a stand-in Commander, when the Commander comes back', () => {
  it('loses the Commander controls and the join queue, and is told why', async () => {
    await standInWithQueueOpen();

    act(() => fakeSocket.receive('demoted-to-member', { roomCode: CODE }));

    // The join queue closes, rather than staying up with every GRANT refused.
    await waitFor(() => expect(screen.queryByText(/INBOUND/)).toBeNull());
    expect(screen.queryByText('Stranger')).toBeNull();
    expect(nodeAccess()).toBeNull();
    expect(screen.queryByRole('button', { name: /SYNC_TELEMETRY/ })).toBeNull();
    await screen.findByText(/COMMANDER IS BACK/);
  });

  it('rejoins as a member on its next reconnect, not as the squad\'s Commander', async () => {
    await standInWithQueueOpen();
    act(() => fakeSocket.receive('demoted-to-member', { roomCode: CODE }));
    fakeSocket.emit.mockClear();

    act(() => fakeSocket.receive('connect'));
    expect(emitted('request-join')).toEqual([[expect.objectContaining({ roomCode: CODE, intent: 'join' })]]);
  });

  it('does not keep the old queue for a later stand-in turn', async () => {
    // The request was the Commander's to decide from the moment they came back. Standing
    // in again later, this client is sent whatever is waiting then, and nothing else.
    await standInWithQueueOpen();
    act(() => fakeSocket.receive('demoted-to-member', { roomCode: CODE }));
    await waitFor(() => expect(nodeAccess()).toBeNull());

    act(() => fakeSocket.receive('promoted-to-owner', { roomCode: CODE }));
    fireEvent.click(await waitFor(() => { const b = nodeAccess(); expect(b).not.toBeNull(); return b; }));
    await screen.findByText(/INBOUND/);
    expect(screen.queryByText('Stranger')).toBeNull();
  });

  it('ignores a notice about another squad', async () => {
    await standInWithQueueOpen();

    act(() => fakeSocket.receive('demoted-to-member', { roomCode: 'OTHER1' }));

    expect(nodeAccess()).not.toBeNull();
    expect(screen.getByText('Stranger')).toBeTruthy();
  });
});
