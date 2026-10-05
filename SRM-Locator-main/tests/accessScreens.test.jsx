// @vitest-environment jsdom
//
// The way into LOCUS after the redesign (piece P3): sign in and create account with problems
// shown in place (amber, never a notice that times out), "reset link sent", the waiting
// screen, "Request not approved", and "You're in", which tells the truth about the person's
// sharing mode. Words come from src/copy/access.js, so wording corrections don't break this.
//
// Renders the real App.jsx; only the socket, Firebase, native plugins, maps and the update
// hooks are stubbed.
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
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
    timeout: () => ({ emit: vi.fn() }),
  };
});

const authState = vi.hoisted(() => ({ user: null }));

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

const firebaseAuth = await import('firebase/auth');
const { default: App } = await import('../src/App.jsx');
const { __resetNotifications, subscribe } = await import('../src/utils/notify.js');
const { STATUS_SCREEN_Z } = await import('../src/components/access/StatusScreen.jsx');
const {
  AUTH_PROBLEMS, CREATE_ACCOUNT, LOBBY, NOT_APPROVED, RESET, SIGN_IN, WAITING, YOURE_IN,
} = await import('../src/copy/access.js');

let notices = [];
let stopNotices;

const field = (label) => screen.getByLabelText(label);
const type = (label, value) => fireEvent.change(field(label), { target: { value } });

// Signed out, first run: the guide opens first; Skip leads to sign-in.
const toSignIn = async () => {
  try { localStorage.removeItem('locus.guideSeen'); } catch { /* no storage */ }
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
};

const joinAs = (code) => {
  fireEvent.click(screen.getByRole('radio', { name: LOBBY.joinTab }));
  fireEvent.change(screen.getByPlaceholderText(LOBBY.joinPlaceholder), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: LOBBY.joinButton }));
};

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  authState.user = null;
  Object.values(firebaseAuth).forEach((fn) => fn?.mockReset?.());
  __resetNotifications();
  stopNotices = subscribe((items) => { notices = items; });
  vi.spyOn(window, 'alert').mockImplementation(() => {});
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
  stopNotices();
  vi.restoreAllMocks();
  delete navigator.geolocation;
  delete globalThis.IntersectionObserver;
});

describe('sign in', () => {
  it('says what is missing in place, in amber, and posts no notice', async () => {
    await toSignIn();
    fireEvent.click(screen.getByRole('button', { name: SIGN_IN.submit }));
    const problem = await screen.findByRole('alert');
    expect(problem.textContent).toBe(AUTH_PROBLEMS.missingEmailAndPassword);
    expect(problem.className).toMatch(/bg-warning-soft/);
    expect(problem.className).not.toMatch(/danger|red-/);
    expect(notices).toEqual([]);
    expect(firebaseAuth.signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('a wrong email or password: the plain sentence, and the password field marked', async () => {
    firebaseAuth.signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/invalid-credential', message: 'Firebase: Error' });
    await toSignIn();
    type(SIGN_IN.email, 'meera@srmist.edu.in');
    type(SIGN_IN.password, 'nope-nope');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SIGN_IN.submit })); });

    expect(screen.getByRole('alert').textContent).toBe(AUTH_PROBLEMS.wrongCredentials);
    expect(field(SIGN_IN.password).getAttribute('aria-invalid')).toBe('true');
    expect(field(SIGN_IN.email).getAttribute('aria-invalid')).toBeNull();
    expect(notices).toEqual([]);
  });

  it('while signing in: the button says so and the fields wait', async () => {
    firebaseAuth.signInWithEmailAndPassword.mockReturnValue(new Promise(() => {}));
    await toSignIn();
    type(SIGN_IN.email, 'meera@srmist.edu.in');
    type(SIGN_IN.password, 'correct-horse');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SIGN_IN.submit })); });

    expect(screen.getByRole('button', { name: SIGN_IN.submitting }).getAttribute('aria-busy')).toBe('true');
    expect(field(SIGN_IN.email).disabled).toBe(true);
    expect(field(SIGN_IN.password).disabled).toBe(true);
    // A second tap does nothing more.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SIGN_IN.submitting })); });
    expect(firebaseAuth.signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
  });

  it('Forgot password: needs the email first, then shows the reset-sent screen with the address', async () => {
    firebaseAuth.sendPasswordResetEmail.mockResolvedValue();
    await toSignIn();
    fireEvent.click(screen.getByRole('button', { name: SIGN_IN.forgotPassword }));
    expect(screen.getByRole('alert').textContent).toBe(AUTH_PROBLEMS.missingEmailForReset);
    expect(firebaseAuth.sendPasswordResetEmail).not.toHaveBeenCalled();

    type(SIGN_IN.email, ' meera@srmist.edu.in ');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SIGN_IN.forgotPassword })); });
    expect(firebaseAuth.sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'meera@srmist.edu.in');
    expect(screen.getByRole('heading', { name: RESET.title })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(RESET.sent('meera@srmist.edu.in').join(''));

    fireEvent.click(screen.getByRole('button', { name: RESET.back }));
    expect(screen.getByRole('heading', { name: SIGN_IN.title })).toBeTruthy();
  });
});

describe('create account', () => {
  it('asks for a name first', async () => {
    await toSignIn();
    fireEvent.click(screen.getByRole('button', { name: SIGN_IN.toCreate }));
    type(SIGN_IN.email, 'meera@srmist.edu.in');
    type(SIGN_IN.password, 'correct-horse');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: CREATE_ACCOUNT.submit })); });
    expect(screen.getByRole('alert').textContent).toBe(AUTH_PROBLEMS.missingName);
    expect(field(CREATE_ACCOUNT.name).getAttribute('aria-invalid')).toBe('true');
    expect(firebaseAuth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('saves the name as typed, not in capitals', async () => {
    firebaseAuth.createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u-new' } });
    firebaseAuth.updateProfile.mockResolvedValue();
    await toSignIn();
    fireEvent.click(screen.getByRole('button', { name: SIGN_IN.toCreate }));
    type(CREATE_ACCOUNT.name, ' Meera Iyer ');
    expect(field(CREATE_ACCOUNT.name).value).toBe(' Meera Iyer ');
    type(SIGN_IN.email, 'meera@srmist.edu.in');
    type(SIGN_IN.password, 'correct-horse');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: CREATE_ACCOUNT.submit })); });
    expect(firebaseAuth.updateProfile).toHaveBeenCalledWith({ uid: 'u-new' }, expect.objectContaining({ displayName: 'Meera Iyer' }));
  });
});

describe('joining a group', () => {
  beforeEach(() => {
    authState.user = { uid: 'u-self', displayName: 'MEERA IYER', photoURL: null };
  });

  it('greets by first name, not in capitals', () => {
    render(<App />);
    expect(screen.getByText(LOBBY.hello('Meera'))).toBeTruthy();
  });

  it('waiting: says who it asked, over the tab bar and under the Emergency button', () => {
    render(<App />);
    joinAs('K7M2QX');
    const waiting = screen.getByRole('dialog', { name: WAITING.title });
    expect(waiting.textContent).toContain('K7M 2QX');
    expect(Number(waiting.style.zIndex)).toBe(STATUS_SCREEN_Z);
    // Today's tab bar is z 1100 and the Emergency button z 1150 (their own classes).
    expect(STATUS_SCREEN_Z).toBeGreaterThan(1100);
    expect(STATUS_SCREEN_Z).toBeLessThan(1150);
    expect(screen.getByRole('button', { name: /SOS beacon/ }).className).toMatch(/z-\[1150\]/);
  });

  it("approved after waiting: You're in, sharing live, and Open the map closes it", () => {
    render(<App />);
    joinAs('K7M2QX');
    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'K7M2QX' }));
    const youreIn = screen.getByRole('dialog', { name: YOURE_IN.title });
    expect(youreIn.textContent).toContain(YOURE_IN.body.ACTIVE);
    expect(youreIn.textContent).toContain(YOURE_IN.chip.ACTIVE);

    fireEvent.click(screen.getByRole('button', { name: YOURE_IN.openMap }));
    expect(screen.queryByRole('dialog', { name: YOURE_IN.title })).toBeNull();
  });

  it("not for a group you create, nor when a reconnect lets you back in", () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: LOBBY.createButton }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
    expect(screen.queryByRole('dialog', { name: YOURE_IN.title })).toBeNull();

    act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
    expect(screen.queryByRole('dialog', { name: YOURE_IN.title })).toBeNull();
  });

  it("tells the truth when sharing is paused: the mode carries over from the last group", () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: LOBBY.createButton }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'FROZEN' }));
    fireEvent.click(screen.getByRole('button', { name: 'DISCONNECT' }));

    joinAs('K7M2QX');
    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'K7M2QX' }));
    const youreIn = screen.getByRole('dialog', { name: YOURE_IN.title });
    expect(youreIn.textContent).toContain(YOURE_IN.body.FROZEN);
    expect(youreIn.textContent).toContain(YOURE_IN.chip.FROZEN);
    expect(youreIn.textContent).not.toContain(YOURE_IN.chip.ACTIVE);
  });

  it('turned down: its own screen, then Try another code goes back with the code kept', () => {
    render(<App />);
    joinAs('K7M2QX');
    act(() => fakeSocket.receive('access-denied', { roomCode: 'K7M2QX' }));
    expect(screen.getByRole('dialog', { name: NOT_APPROVED.title }).textContent).toContain('K7M 2QX');
    expect(notices).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: NOT_APPROVED.tryAnother }));
    expect(screen.getByPlaceholderText(LOBBY.joinPlaceholder).value).toBe('K7M2QX');
  });
});

describe('the words', () => {
  it('none of the way in is in the old tactical vocabulary', async () => {
    const copy = await import('../src/copy/access.js');
    // Every sentence the copy holds: its strings, and what its functions say for a sample.
    const sentences = [];
    const walk = (value) => {
      if (typeof value === 'string') sentences.push(value);
      else if (typeof value === 'function') walk(value('K7M2QX'));
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(copy.BOOT); walk(copy.SIGN_IN); walk(copy.CREATE_ACCOUNT); walk(copy.RESET); walk(copy.AUTH_PROBLEMS);
    walk(copy.LOBBY); walk(copy.WAITING); walk(copy.NOT_APPROVED); walk(copy.YOURE_IN);
    expect(sentences.length).toBeGreaterThan(50);
    sentences.forEach((s) => expect(s).not.toMatch(/\bsquad\b|commander|operative|\bnode\b|handshake|clearance|\[|_[A-Z]/i));
  });
});
