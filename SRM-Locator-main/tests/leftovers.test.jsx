// @vitest-environment jsdom
//
// Nothing of a Group outlives leaving it, and nothing of an account outlives signing out
// (App.jsx: endSquadSession, resetAccountState). Each of these used to: the password stayed in
// the sign-in box after Sign out, an unanswered SOS stayed over the sign-in screen, a cancelled
// wait was offered back as "Return to", and a locations reply nobody asked for opened the table.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

MotionGlobalConfig.skipAnimations = true;

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
    timeout: () => ({ emit: vi.fn() }),
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
  };
});

// Who is signed in, as the test says: `auth.signIn(user)` / `auth.signIn(null)`.
const auth = vi.hoisted(() => {
  const state = { user: { uid: 'u-self', displayName: 'Alpha', photoURL: null }, callback: null };
  return {
    state,
    signIn: (user) => { state.user = user; state.callback?.(user); },
  };
});

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    auth.state.callback = callback;
    callback(auth.state.user);
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
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: () => <div data-testid="leaflet-stub" />,
}));
vi.mock('../src/hooks/useLiveUpdate.js', () => ({
  useLiveUpdate: () => ({ status: 'idle', supported: false, restart: vi.fn() }),
}));
vi.mock('../src/hooks/useAppUpdate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAppUpdate: () => ({
      supported: false, status: actual.UpdateStatus.IDLE, manifest: null, installedVersion: null,
      progress: { percent: -1, loaded: 0, total: 0 }, error: null, mandatory: false, dismissed: false,
      check: vi.fn(), startDownload: vi.fn(), openInstallSettings: vi.fn(), dismiss: vi.fn(),
    }),
  };
});

const { default: App } = await import('../src/App.jsx');
const { SIGN_IN, WAITING, RESUME } = await import('../src/copy/access.js');
const { SOS_RECEIVED } = await import('../src/copy/emergency.js');
const { MAP_CONTROLS } = await import('../src/copy/map.js');
const { SETTINGS } = await import('../src/copy/settings.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
const SELF = { uid: 'u-self', displayName: 'Alpha', photoURL: null };
let code;

const onTheMap = async () => {
  localStorage.setItem('locus.cameraAllowed', '1');
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  await screen.findByTestId('leaflet-stub');
};

beforeEach(() => {
  window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('locus.guideSeen', '1');
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  auth.state.user = SELF;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, speed: 0 } })),
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

describe('signing out', () => {
  it('leaves the sign-in boxes empty, the password hidden', async () => {
    auth.state.user = null;
    render(<App />);
    fireEvent.change(screen.getByLabelText(SIGN_IN.email), { target: { value: 'alpha@srmist.edu.in' } });
    fireEvent.change(screen.getByLabelText(SIGN_IN.password), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: SIGN_IN.showPassword }));
    act(() => auth.signIn(SELF));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    act(() => auth.signIn(null));
    expect(screen.getByLabelText(SIGN_IN.email).value).toBe('');
    const password = screen.getByLabelText(SIGN_IN.password);
    expect(password.value).toBe('');
    expect(password.getAttribute('type')).toBe('password');
  });

  it('leaves no unanswered SOS over the sign-in screen', async () => {
    await onTheMap();
    act(() => fakeSocket.receive('sos-received', { id: 'sos-1', senderId: 'sock-Bravo', senderName: 'Bravo', lat: HERE.lat, lng: HERE.lng, timestamp: Date.now() }));
    expect(screen.getAllByText(SOS_RECEIVED.needsHelp('Bravo')).length).toBeGreaterThan(0);
    const gear = screen.getByRole('button', { name: MAP_CONTROLS.settings });
    fireEvent.pointerDown(gear, { button: 0 });
    fireEvent.click(gear);
    fireEvent.click(await screen.findByRole('button', { name: SETTINGS.signOut }));
    act(() => auth.signIn(null));
    expect(screen.queryByText(SOS_RECEIVED.needsHelp('Bravo'))).toBeNull();
  });
});

describe('cancelling the wait to be let back in', () => {
  it('forgets the Group: the next launch does not offer it back', async () => {
    localStorage.setItem('locus.group', JSON.stringify({ v: 2, code: 'OLDGRP', role: 'MEMBER', uid: 'u-self' }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: RESUME.returnButton('OLDGRP') }));
    act(() => fakeSocket.receive('access-pending', { roomCode: 'OLDGRP' }));
    fireEvent.click(await screen.findByRole('button', { name: WAITING.cancel }));
    expect(localStorage.getItem('locus.group')).toBeNull();
  });
});

describe('the locations table', () => {
  it('is not opened by a reply nobody asked for (one arriving after it was closed, or after leaving)', async () => {
    await onTheMap();
    act(() => fakeSocket.receive('telemetry-sync-complete', { 'sock-Bravo': { name: 'Bravo', lat: HERE.lat, lng: HERE.lng } }));
    await act(async () => {});
    expect(screen.queryByText('SYS_TELEMETRY // MATRIX')).toBeNull();
    expect(within(document.body).queryByRole('dialog', { name: 'SYS_TELEMETRY // MATRIX' })).toBeNull();
  });
});
