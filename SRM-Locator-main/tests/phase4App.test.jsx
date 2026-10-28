// @vitest-environment jsdom
//
// Phase 4 fixes through the real App.jsx (only its edges are stubbed: socket, Firebase, native
// plugins, the maps, update hooks):
//  - a member sharing as Hidden who loses signal: no crash, no marker, no "lost connection";
//  - a lost teammate's card carries their last known location, so Rally sets it there;
//  - a building tapped on the map mid-route opens its card and keeps the route;
//  - a new place's card starts at its first photo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
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
// The free map, standing in: what App gives it, and a tap on a lost teammate or a place.
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: (props) => (
    <div
      data-testid="leaflet-stub"
      data-users={JSON.stringify(props.users.map((u) => ({ id: u.id, lat: u.lat, lng: u.lng })))}
      data-ghosts={JSON.stringify(props.ghostMembers.map((g) => ({ id: g.id, position: g.position })))}
    >
      {props.ghostMembers.map((g) => (
        <button key={g.id} type="button" data-testid={`stub-ghost-${g.id}`} onClick={() => props.onFocus(g.position, props.ghostFocusItem(g))} />
      ))}
      {props.places.slice(0, 3).map((place) => (
        <button key={place.name} type="button" aria-label={`dot ${place.name}`} onClick={() => props.onFocus({ lat: place.lat, lng: place.lng }, place)} />
      ))}
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
const { NOTICES } = await import('../src/copy/notices.js');
const { MEETING_POINT_CONFIRM } = await import('../src/copy/place.js');
const { GROUP_TABS, MEMBER_OPTIONS, MEMBERS } = await import('../src/copy/group.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
const BRAVO_AT = { lat: 12.8240, lng: 80.0440 };
let code;
const bravo = (extra = {}) => ({
  'sock-Bravo': { uid: 'u-Bravo', name: 'Bravo', roomCode: code, lat: BRAVO_AT.lat, lng: BRAVO_AT.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now(), ...extra },
});
const stub = () => screen.getByTestId('leaflet-stub');
const shown = (attr) => JSON.parse(stub().getAttribute(attr));
const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, ...args]) => args);
const card = () => within(screen.getByTestId('location-card'));

// `members` is a function, called once the group's code is known; `listed`: how many of them the
// map should show once the list is in.
const onTheMap = async (members = () => bravo(), listed = 1) => {
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await screen.findByTestId('leaflet-stub');
  // Sent again until it lands: a list that comes in before the group's code has reached the
  // handler is (rightly) dropped as another group's.
  const list = members();
  await waitFor(() => {
    act(() => fakeSocket.receive('users-update', list));
    expect(shown('data-users')).toHaveLength(listed);
  }, { timeout: 3000 });
};

beforeEach(() => {
  window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  localStorage.clear();
  sessionStorage.clear();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  // The walking route asks a routing service; here it falls back to the straight line.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
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
  vi.unstubAllGlobals();
  delete navigator.geolocation;
});

describe('a member sharing as Hidden loses signal', () => {
  it('takes them off quietly: no crash, no marker, no "lost connection"', async () => {
    await onTheMap(() => bravo({ status: 'GHOST', lat: null, lng: null }), 0);
    expect(() => act(() => fakeSocket.receive('member-signal-lost', {
      targetId: 'sock-Bravo', uid: 'u-Bravo', name: 'Bravo', lastKnownLocation: null, timeDelta: 0,
    }))).not.toThrow();
    expect(shown('data-ghosts')).toEqual([]);
    expect(shown('data-users')).toEqual([]);
    expect(document.body.textContent).not.toContain(NOTICES.signalLost.title('Bravo'));
  });

  it('a member with a position still gets their marker and the notice', async () => {
    await onTheMap();
    act(() => fakeSocket.receive('member-signal-lost', {
      targetId: 'sock-Bravo', uid: 'u-Bravo', name: 'Bravo',
      lastKnownLocation: { latitude: BRAVO_AT.lat, longitude: BRAVO_AT.lng }, timeDelta: 0,
    }));
    expect(shown('data-ghosts')).toEqual([{ id: 'sock-Bravo', position: BRAVO_AT }]);
    expect(document.body.textContent).toContain(NOTICES.signalLost.title('Bravo'));
  });
});

describe("a lost teammate's card", () => {
  it('carries their last known location, so Rally sets the meeting point there', async () => {
    await onTheMap();
    act(() => fakeSocket.receive('member-signal-lost', {
      targetId: 'sock-Bravo', uid: 'u-Bravo', name: 'Bravo',
      lastKnownLocation: { latitude: BRAVO_AT.lat, longitude: BRAVO_AT.lng }, timeDelta: 0,
    }));
    fireEvent.click(screen.getByTestId('stub-ghost-sock-Bravo'));
    const rally = card().getByTestId('place-rally');
    expect(rally.disabled).toBe(false);
    expect(card().getByTestId('place-navigate').disabled).toBe(false);
    fireEvent.click(rally);
    const dialog = screen.getByRole('dialog', { name: /meeting point|rally/i });
    fireEvent.click(within(dialog).getByRole('button', { name: MEETING_POINT_CONFIRM.confirm }));
    const [[{ waypoint }]] = emitted('publish-waypoint');
    expect({ lat: waypoint.lat, lng: waypoint.lng }).toEqual(BRAVO_AT);
  });
});

describe('a building tapped on the map mid-route', () => {
  it('opens its card and keeps the route', async () => {
    // The wide layout, where the Group's list and the map show side by side.
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    await onTheMap();
    fireEvent.click(screen.getByRole('radio', { name: GROUP_TABS.members }));
    fireEvent.click(screen.getByRole('button', { name: MEMBERS.options('Bravo') }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(MEMBER_OPTIONS.navigate('Bravo')) }));
    expect(await screen.findByTestId('turn-instruction-card')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /^dot / })[0]);
    expect(await screen.findByTestId('location-card')).toBeTruthy();
    expect(screen.getByTestId('turn-instruction-card')).toBeTruthy();
  });
});

describe('the place card', () => {
  it("starts a new place at its first photo, not the last place's", async () => {
    await onTheMap();
    const dots = screen.getAllByRole('button', { name: /^dot / });
    fireEvent.click(dots[0]);
    fireEvent.click(card().getByRole('button', { name: 'Next photo' }));
    expect(card().getByText(/^2\//)).toBeTruthy();
    fireEvent.click(dots[1]);
    await waitFor(() => expect(card().getByText(/^1\//)).toBeTruthy());
  });
});
