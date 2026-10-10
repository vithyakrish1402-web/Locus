// @vitest-environment jsdom
//
// Members on the map, through the real App.jsx on the Google engine (redesign Map batch,
// piece 5): live members with their name and distance, paused members marked paused, hidden
// members not drawn at all (as before), and nothing red.
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
// The Google engine's children (the markers) rendered as they are.
vi.mock('google-map-react', () => ({ default: ({ children }) => <div data-testid="google-map">{children}</div> }));
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

vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');
const { default: App } = await import('../src/App.jsx');

const HERE = { lat: 12.8230, lng: 80.0440 };
let code;
const onTheMapWithMembers = async (members) => {
  navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, speed: 0 } });
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  act(() => fakeSocket.receive('users-update', members()));
};
const member = (id, extra) => ({ [id]: { uid: `u-${id}`, roomCode: code, lat: HERE.lat + 0.001, lng: HERE.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', ...extra } });

beforeEach(() => {
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

describe('members on the map', () => {
  it('a live member: initials, name as sent, and how far from you', async () => {
    await onTheMapWithMembers(() => ({ ...member('s-meera', { name: 'Meera Iyer' }) }));
    const marker = await waitFor(() => screen.getByTestId('member-marker'));
    expect(marker.textContent).toMatch(/^MIMeera Iyer · 1\d\d m$/);
  });

  it('a paused member is marked paused', async () => {
    await onTheMapWithMembers(() => ({ ...member('s-rohan', { name: 'Rohan', status: 'FROZEN' }) }));
    const marker = await waitFor(() => screen.getByTestId('member-marker'));
    expect(marker.dataset.paused).toBe('true');
    expect(marker.textContent).toContain('Rohan · paused');
  });

  it('a hidden member is not drawn at all, as before', async () => {
    await onTheMapWithMembers(() => ({ ...member('s-ishita', { name: 'Ishita', status: 'GHOST' }) }));
    await act(async () => {});
    expect(screen.queryByTestId('member-marker')).toBeNull();
    expect(screen.queryByText(/Ishita/)).toBeNull();
  });

  it('nothing on the map is red', async () => {
    await onTheMapWithMembers(() => ({ ...member('s-meera', { name: 'Meera' }) }));
    await waitFor(() => screen.getByTestId('member-marker'));
    expect(screen.getByTestId('google-map').innerHTML).not.toMatch(/#EF4444|red-500|red-600/i);
  });
});
