// @vitest-environment jsdom
//
// AR Scan glitches from the v1.1.69 recording, through the real App.jsx: a giant "play" icon before
// the camera shows; the HUD showing through the target picker; the picker's sheet dropping over the
// distance card as the keyboard closes; and the controls and tags under the status bar.
// Only the app's edges are stubbed (socket, Firebase, native plugins, the maps, update hooks).
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

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback({ uid: 'u-self', displayName: 'Alpha', photoURL: null });
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
// A stand-in for the free map that shows what App tells it: whether the dots are on, and a
// dot to tap.
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: (props) => (
    <div data-testid="leaflet-stub" data-dots={String(props.showBuildings)}>
      <button type="button" data-testid="stub-dot" onClick={() => props.onFocus({ lat: props.places[0].lat, lng: props.places[0].lng }, props.places[0])}>dot</button>
    </div>
  ),
}));
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

const HERE = { lat: 12.8230, lng: 80.0440 };
let code;
const bravo = () => ({
  'sock-Bravo': { uid: 'u-Bravo', name: 'Bravo', roomCode: code, lat: HERE.lat + 0.001, lng: HERE.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now() },
});
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('locus.cameraAllowed', '1');
  window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  // The camera is there (a stream that does nothing); jsdom plays nothing, so the test says when it plays.
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [] })) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  fakeSocket.handlers.clear();
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
  delete navigator.mediaDevices;
});

const scanning = async () => {
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  act(() => fakeSocket.receive('users-update', bravo()));
  fireEvent.click(tabBar().getByRole('button', { name: 'Scan' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start AR Scan$/ })));
};
const picker = () => screen.queryByRole('dialog', { name: 'What do you want to find?' });
const openPicker = async () => {
  await scanning();
  fireEvent.click(screen.getByTestId('ar-target-pill'));
  return screen.getByRole('dialog', { name: 'What do you want to find?' });
};

describe('the camera picture', () => {
  it('stays hidden until it is playing, and shows no controls or placeholder of its own', async () => {
    await scanning();
    const video = screen.getByTestId('ar-video');
    expect(video.className).toContain('opacity-0');
    expect(video.className).not.toContain('opacity-100');
    expect(video.controls).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.getAttribute('poster')).toMatch(/^data:image\/gif;base64,/); // a transparent pixel, so no default "play" picture
    fireEvent(video, new Event('playing'));
    expect(video.className).toContain('opacity-100');
    expect(video.getAttribute('data-playing')).toBe('true');
  });
});

describe('the target picker over the HUD', () => {
  it('is opaque (the solid surface, not see-through glass)', async () => {
    const dialog = await openPicker();
    expect(dialog.className).toContain('glass-solid');
    expect(dialog.className).not.toContain('glass-floating');
  });

  it('hides the HUD and takes its touches while it is open, and brings it back after the sheet has left', async () => {
    const hud = (await scanning(), screen.getByTestId('ar-ui'));
    expect(hud.style.opacity).toBe('1');
    expect(hud.hasAttribute('inert')).toBe(false);

    fireEvent.click(screen.getByTestId('ar-target-pill'));
    expect(hud.style.opacity).toBe('0');
    expect(hud.style.pointerEvents).toBe('none');
    expect(hud.hasAttribute('inert')).toBe(true);
    expect(hud.style.transition).toMatch(/opacity 150ms ease 0ms/); // gone at once

    fireEvent.keyDown(picker(), { key: 'Escape' });
    expect(hud.style.opacity).toBe('1');
    expect(hud.hasAttribute('inert')).toBe(false);
    expect(hud.style.transition).toMatch(/opacity 150ms ease 300ms/); // back only after the sheet is gone
  });

  it('lets go of its search field before it closes, so the keyboard leaves first', async () => {
    const dialog = await openPicker();
    const field = within(dialog).getByRole('searchbox');
    act(() => field.focus());
    expect(document.activeElement).toBe(field);
    const blur = vi.spyOn(field, 'blur');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(blur).toHaveBeenCalled(); // before the sheet starts to leave, not as a side effect of its going
  });

  it('lets go of it when a place is chosen too', async () => {
    const dialog = await openPicker();
    const field = within(dialog).getByRole('searchbox');
    act(() => field.focus());
    const blur = vi.spyOn(field, 'blur');
    fireEvent.click(within(dialog).getAllByTestId('ar-picker-row')[0]);
    expect(blur).toHaveBeenCalled();
  });
});

describe('the HUD and the status bar', () => {
  it('starts below the status bar strip (--top-cover-height), as Settings does', async () => {
    await scanning();
    expect(screen.getByTestId('ar-ui').style.paddingTop).toBe('calc(var(--top-cover-height) + 1.5rem)');
  });
});
