// @vitest-environment jsdom
//
// The client half of a squad code reaching the squad it names (the server half is in
// squadCodeRouting.e2e.test.js).
//
//  - INITIALIZE and CONNECT sent identical requests, so the server could only guess
//    which was meant, and guessed "create if missing, join if present" for both.
//  - The access replies ('access-granted', '-pending', '-denied') were acted on whatever
//    squad they were about: an approval from a squad the user had given up on flipped
//    their role in the squad they were in, and a stale denial threw them out of it.
//  - ABORT HANDSHAKE never told the server, so the Commander could still approve them.
//  - A Commander's queue survived leaving, and GRANT answered for the Commander's
//    current squad rather than the one the request was made to.
//  - After leaving a squad you had created, the lobby sat on "GENERATING..." and
//    INITIALIZE did nothing.
//
// Renders the real App.jsx and walks it through the real lobby; only the socket
// transport, Firebase, native plugins, maps and the update hooks are stubbed.
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
// The comms feed (notices that replaced alert()) is module-level; each test starts it empty,
// so "the" role="alert" below is the lobby's own notice and not a leftover from a test before.
const { __resetNotifications } = await import('../src/utils/notify.js');

// --- walking the real UI ---------------------------------------------------------

const joinRequests = () => fakeSocket.emit.mock.calls.filter(([event]) => event === 'request-join').map(([, p]) => p);
const lastJoinRequest = () => joinRequests().at(-1);
const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, p]) => p);

// The lobby's generated code, as displayed on the CREATE screen.
const displayedCode = () => screen.getByText('GENERATED SQUAD DESIGNATOR').parentElement.querySelector('span').textContent;

// Signed in -> lobby (CREATE is the default tab) -> INITIALIZE. Returns the squad's code.
const createSquad = () => {
  const code = displayedCode();
  fireEvent.click(screen.getByRole('button', { name: /initialize squad/i }));
  return code;
};

// Signed in -> lobby -> JOIN SQUAD -> code -> CONNECT.
const joinSquad = (code = 'KTR7X9') => {
  fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
  fireEvent.change(screen.getByPlaceholderText('E.G. KTR7X9'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /connect to squad/i }));
  return code;
};

const openSquadTab = () => fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' })[0]);
// The squad panel's own DISCONNECT (leave the squad), not the header's log-out.
const leaveSquad = () => {
  openSquadTab();
  fireEvent.click(screen.getByRole('button', { name: 'DISCONNECT' }));
};
const inLobby = () => Boolean(screen.queryByText('SECURE_CHANNEL'));
const nodeAccessButton = () => screen.queryByRole('button', { name: /NODE_ACCESS/ });

let alertSpy;

beforeEach(() => {
  __resetNotifications();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  // jsdom has no geolocation, and a granted squad starts tracking straight away. A fix
  // that never comes is all these tests need.
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  alertSpy.mockRestore();
  delete navigator.geolocation;
});

describe('what the app asks the server for', () => {
  it('INITIALIZE asks to create, CONNECT asks to join', () => {
    render(<App />);
    const code = createSquad();
    expect(lastJoinRequest()).toMatchObject({ roomCode: code, intent: 'create', user: { uid: 'u-self' } });

    cleanup();
    fakeSocket.handlers.clear();
    render(<App />);
    joinSquad('KTR7X9');
    expect(lastJoinRequest()).toMatchObject({ roomCode: 'KTR7X9', intent: 'join' });
  });

  it('after a reconnect, a Commander resumes their squad and a member re-joins theirs', () => {
    render(<App />);
    const code = createSquad();
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
    act(() => fakeSocket.receive('connect'));
    expect(lastJoinRequest()).toMatchObject({ roomCode: code, intent: 'resume' });

    cleanup();
    fakeSocket.handlers.clear();
    render(<App />);
    joinSquad('KTR7X9');
    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'KTR7X9' }));
    act(() => fakeSocket.receive('connect'));
    expect(lastJoinRequest()).toMatchObject({ roomCode: 'KTR7X9', intent: 'join' });
  });

  it('a Commander the server has put back in a waiting room re-joins, rather than resuming', () => {
    // Their squad was lost and re-founded under its code by someone else (a build that
    // predates intents still founds squads on JOIN), so resuming queued them as a joiner.
    // From there a reconnect must only re-join: resuming would found yet another squad
    // under the code if that one went too.
    render(<App />);
    const code = createSquad();
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
    act(() => fakeSocket.receive('access-pending', { roomCode: code }));
    act(() => fakeSocket.receive('connect'));
    expect(lastJoinRequest()).toMatchObject({ roomCode: code, intent: 'join' });
  });

  it('a joiner still waiting re-joins, never resumes, even if they were a Commander before', () => {
    render(<App />);
    createSquad(); // OWNER of their own squad...
    leaveSquad(); // ...then left it
    joinSquad('KTR7X9');
    act(() => fakeSocket.receive('connect'));
    expect(lastJoinRequest()).toMatchObject({ roomCode: 'KTR7X9', intent: 'join' });
  });
});

describe('replies about a different squad', () => {
  it('an approval from another squad leaves the Commander a Commander', () => {
    render(<App />);
    const code = createSquad();
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
    openSquadTab();
    expect(nodeAccessButton()).toBeTruthy();

    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'OTHER1' }));
    expect(nodeAccessButton()).toBeTruthy();
  });

  it('a denial from another squad does not throw you out of yours', () => {
    render(<App />);
    createSquad();
    act(() => fakeSocket.receive('access-denied', { roomCode: 'OTHER1' }));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(inLobby()).toBe(false);
  });

  it('a denial for the squad you asked to join still sends you back', () => {
    render(<App />);
    joinSquad('KTR7X9');
    act(() => fakeSocket.receive('access-denied', { roomCode: 'KTR7X9' }));
    expect(inLobby()).toBe(true);
  });
});

describe('the waiting room', () => {
  it('ABORT HANDSHAKE withdraws the request from the server, not just the screen', () => {
    render(<App />);
    joinSquad('KTR7X9');
    act(() => fakeSocket.receive('access-pending', { roomCode: 'KTR7X9' }));
    fireEvent.click(screen.getByRole('button', { name: /abort handshake/i }));
    expect(emitted('cancel-join')).toEqual([{ roomCode: 'KTR7X9' }]);
    expect(inLobby()).toBe(true);
  });
});

describe('a request the server turns down', () => {
  it('a JOIN for a code no live squad has comes back to the lobby, with the code kept and the reason shown', () => {
    render(<App />);
    joinSquad('KTR7X9');
    act(() => fakeSocket.receive('squad-not-found', { roomCode: 'KTR7X9' }));

    expect(inLobby()).toBe(true);
    expect(screen.getByPlaceholderText('E.G. KTR7X9').value).toBe('KTR7X9');
    expect(screen.getByRole('alert').textContent).toMatch(/no active squad/i);
  });

  it('a CREATE under a code that is already live comes back with a fresh code to share', () => {
    render(<App />);
    const code = createSquad();
    act(() => fakeSocket.receive('squad-code-taken', { roomCode: code }));

    expect(inLobby()).toBe(true);
    expect(displayedCode()).toMatch(/^[A-Z0-9]{6}$/);
    expect(displayedCode()).not.toBe(code);
    expect(screen.getByRole('alert').textContent).toMatch(/already in use/i);
  });

  it('a squad that vanished while you were in it sends you back with the reason', () => {
    render(<App />);
    joinSquad('KTR7X9');
    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'KTR7X9' }));
    act(() => fakeSocket.receive('squad-not-found', { roomCode: 'KTR7X9' }));

    expect(inLobby()).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/no longer exists/i);
  });

  it('ignores a refusal about some other code', () => {
    render(<App />);
    createSquad();
    act(() => fakeSocket.receive('squad-not-found', { roomCode: 'OTHER1' }));
    act(() => fakeSocket.receive('squad-code-taken', { roomCode: 'OTHER1' }));
    expect(inLobby()).toBe(false);
  });
});

describe('the lobby after leaving', () => {
  it('has a fresh code ready after leaving a squad you created', () => {
    render(<App />);
    const first = createSquad();
    leaveSquad();

    expect(inLobby()).toBe(true);
    expect(displayedCode()).toMatch(/^[A-Z0-9]{6}$/);
    expect(displayedCode()).not.toBe(first);

    fakeSocket.emit.mockClear();
    const second = createSquad();
    expect(lastJoinRequest()).toMatchObject({ roomCode: second, intent: 'create' });
  });
});

describe("the Commander's queue", () => {
  const badge = () => within(nodeAccessButton()).queryByText(/^\d+$/)?.textContent ?? null;

  it('holds one entry per request, and drops a request the joiner withdrew', () => {
    render(<App />);
    const code = createSquad();
    openSquadTab();

    const request = { targetId: 't1', name: 'X', photo: null, roomCode: code };
    act(() => fakeSocket.receive('access-request', request));
    act(() => fakeSocket.receive('access-request', request)); // re-sent (e.g. after a reconnect)
    expect(badge()).toBe('1');

    act(() => fakeSocket.receive('access-request-withdrawn', { targetId: 't1', roomCode: code }));
    expect(badge()).toBeNull();
  });

  it('answers a request for the squad it was made to', () => {
    render(<App />);
    const code = createSquad();
    openSquadTab();
    act(() => fakeSocket.receive('access-request', { targetId: 't1', name: 'X', photo: null, roomCode: code }));

    fireEvent.click(nodeAccessButton());
    fireEvent.click(screen.getByRole('button', { name: 'GRANT_ACCESS' }));
    expect(emitted('resolve-access')).toEqual([{ targetId: 't1', roomCode: code, approved: true }]);
  });

  it('does not follow the Commander into their next squad', () => {
    render(<App />);
    const code = createSquad();
    act(() => fakeSocket.receive('access-request', { targetId: 't1', name: 'X', photo: null, roomCode: code }));
    leaveSquad();

    fireEvent.click(screen.getByRole('button', { name: 'CREATE SQUAD' }));
    createSquad();
    openSquadTab();
    expect(badge()).toBeNull();
  });
});
