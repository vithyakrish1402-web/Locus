// @vitest-environment jsdom
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
      handlers.get(event)?.add(fn);
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
vi.mock('google-map-react', () => ({ default: () => <div data-testid="google-map" /> }));
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({ default: () => <div data-testid="map" /> }));
vi.mock('../src/hooks/useLiveUpdate.js', () => ({
  useLiveUpdate: () => ({ status: 'idle', supported: false, restart: vi.fn() }),
}));

import App from '../src/App.jsx';

describe('Navigate without GPS and with GPS test', () => {
  afterEach(() => {
    cleanup();
    delete navigator.geolocation;
  });

  const joinAsMember = async () => {
    fireEvent.click(screen.getByRole('radio', { name: 'Join a group' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: 'KTR7X9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'KTR7X9' }));
    await screen.findByTestId('map');
  };

  it('clicking Navigate when GPS is NOT yet available does not crash the app', async () => {
    // navigator.geolocation returns nothing or errors
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
    });

    render(<App />);
    await joinAsMember();

    const navButtons = await screen.findAllByRole('button', { name: /Navigate/i });
    expect(navButtons.length).toBeGreaterThan(0);

    // Click Navigate on the first building
    act(() => {
      fireEvent.click(navButtons[0]);
    });

    // Verify app did not crash (map is still there)
    expect(screen.getByTestId('map')).toBeTruthy();
  });
});
