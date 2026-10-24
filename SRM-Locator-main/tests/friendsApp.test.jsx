// @vitest-environment jsdom
//
// Trusted friends in the real App.jsx (Option A, 2026-10-24): asking a member, accepting or
// declining a request, cancelling and ending a friendship, the "Trusted friend" mark on a card,
// and the server told each time ('friends-changed'). Firestore is a stand-in that holds the
// documents in memory and feeds the live watch, as onSnapshot would.
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
// The friendships "in Firestore", keyed by pair id, and the one live watch on them.
const store = vi.hoisted(() => ({ docs: new Map(), watcher: null, fail: false }));
vi.mock('../src/utils/friends.js', async (importOriginal) => {
  const real = await importOriginal();
  const push = () => store.watcher?.(real.summarizeFriendships(store.watcher.uid, [...store.docs.values()].filter((d) => d.users.includes(store.watcher.uid))));
  const write = (fn) => (store.fail ? Promise.reject(new Error('permission-denied')) : Promise.resolve(fn()).then(push));
  return {
    ...real,
    watchFriendships: (uid, onChange) => {
      store.watcher = Object.assign((s) => onChange(s), { uid });
      push();
      return () => { store.watcher = null; };
    },
    sendFriendRequest: (me, other) => write(() => store.docs.set(real.friendshipId(me.uid, other.uid), {
      id: real.friendshipId(me.uid, other.uid), users: [me.uid, other.uid].sort(), requester: me.uid, status: 'pending', names: { [me.uid]: me.name, [other.uid]: other.name },
    })),
    acceptFriendRequest: (me, otherUid) => write(() => { store.docs.get(real.friendshipId(me.uid, otherUid)).status = 'accepted'; }),
    removeFriendship: (me, otherUid) => write(() => store.docs.delete(real.friendshipId(me.uid, otherUid))),
    __push: push,
  };
});
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
const { __resetNotifications, subscribe } = await import('../src/utils/notify.js');
const { NOTICES } = await import('../src/copy/notices.js');
const { FRIENDS } = await import('../src/copy/group.js');
const friendsModule = await import('../src/utils/friends.js');
let feed = [];
subscribe((items) => { feed = items; });
const noticeUp = (text) => feed.some((n) => n.message === text || n.body === text);

const HERE = { lat: 12.8230, lng: 80.0440 };
let code;
const bravo = () => ({
  'sock-Bravo': { uid: 'u-Bravo', name: 'Bravo', roomCode: code, lat: HERE.lat + 0.001, lng: HERE.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now() },
});
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const currentTab = () => tabBar().getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.textContent;
// jsdom has no layout: say whether the screen is a phone's (the app asks matchMedia).
const screenIs = (phone) => {
  window.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
};
const dots = () => screen.getByTestId('leaflet-stub').getAttribute('data-dots');

const onTheMap = async ({ cameraKnown = true } = {}) => {
  if (cameraKnown) localStorage.setItem('locus.cameraAllowed', '1');
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  act(() => fakeSocket.receive('users-update', bravo()));
  await screen.findByTestId('leaflet-stub');
};

beforeEach(() => {
  screenIs(true);
  localStorage.clear();
  sessionStorage.clear();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
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

beforeEach(() => {
  __resetNotifications();
  store.docs.clear();
  store.fail = false;
});

const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event);
const openGroup = () => fireEvent.click(tabBar().getByRole('button', { name: /Group/ }));
const options = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
  await screen.findByTestId('member-options');
};
const settle = () => act(async () => {});
// Bravo asks this phone (u-self), as their own phone would write it.
const bravoAsks = () => act(() => {
  store.docs.set('u-Bravo_u-self', { id: 'u-Bravo_u-self', users: ['u-Bravo', 'u-self'], requester: 'u-Bravo', status: 'pending', names: { 'u-Bravo': 'Bravo', 'u-self': 'Alpha' } });
  friendsModule.__push();
});

describe('asking a member to be a trusted friend', () => {
  it('writes the request, tells the server, and offers to cancel it', async () => {
    await onTheMap();
    openGroup();
    await options();
    fireEvent.click(screen.getByText(FRIENDS.add));
    await settle();
    expect(store.docs.get('u-Bravo_u-self')).toMatchObject({ requester: 'u-self', status: 'pending', users: ['u-Bravo', 'u-self'] });
    expect(emitted('friends-changed').at(-1)[1]).toEqual({ uid: 'u-Bravo' });
    await options();
    fireEvent.click(screen.getByText(FRIENDS.sent));
    await settle();
    expect(store.docs.size).toBe(0);
  });

  it('says so when Firestore refuses', async () => {
    store.fail = true;
    await onTheMap();
    openGroup();
    await options();
    fireEvent.click(screen.getByText(FRIENDS.add));
    await settle();
    expect(feed.some((n) => n.message === FRIENDS.failed)).toBe(true);
    expect(emitted('friends-changed')).toEqual([]);
  });
});

describe('a friend request from a member', () => {
  it('shows above the members, and can be accepted: the card then says Trusted friend', async () => {
    await onTheMap();
    openGroup();
    expect(screen.queryByTestId('member-friend')).toBeNull();
    bravoAsks();
    fireEvent.click(screen.getByRole('button', { name: FRIENDS.requestsButton(1) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept Bravo' }));
    await settle();
    expect(store.docs.get('u-Bravo_u-self').status).toBe('accepted');
    expect(emitted('friends-changed').at(-1)[1]).toEqual({ uid: 'u-Bravo' });
    expect(screen.getByTestId('member-friend').textContent).toBe(FRIENDS.badge);
    expect(screen.queryByRole('button', { name: FRIENDS.requestsButton(1) })).toBeNull();
  });

  it('can be declined', async () => {
    await onTheMap();
    openGroup();
    bravoAsks();
    fireEvent.click(screen.getByRole('button', { name: FRIENDS.requestsButton(1) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Decline Bravo' }));
    await settle();
    expect(store.docs.size).toBe(0);
    expect(screen.queryByTestId('member-friend')).toBeNull();
  });

  it("can be accepted from the member's options too", async () => {
    await onTheMap();
    openGroup();
    bravoAsks();
    await options();
    fireEvent.click(screen.getByText(FRIENDS.acceptRequest));
    await settle();
    expect(store.docs.get('u-Bravo_u-self').status).toBe('accepted');
  });
});

describe('a trusted friend', () => {
  it('can be removed, and the server is told', async () => {
    await onTheMap();
    act(() => {
      store.docs.set('u-Bravo_u-self', { id: 'u-Bravo_u-self', users: ['u-Bravo', 'u-self'], requester: 'u-self', status: 'accepted', names: {} });
      friendsModule.__push();
    });
    openGroup();
    expect(screen.getByTestId('member-friend')).toBeTruthy();
    await options();
    fireEvent.click(screen.getByText(FRIENDS.remove));
    await settle();
    expect(store.docs.size).toBe(0);
    expect(screen.queryByTestId('member-friend')).toBeNull();
    expect(emitted('friends-changed').at(-1)[1]).toEqual({ uid: 'u-Bravo' });
  });
});

describe('summarizeFriendships', () => {
  it('sorts friendships into friends, requests to answer, and requests sent', () => {
    const s = friendsModule.summarizeFriendships('me', [
      { id: '1', users: ['a', 'me'], status: 'accepted', requester: 'a' },
      { id: '2', users: ['b', 'me'], status: 'pending', requester: 'b', names: { b: 'Bee' } },
      { id: '3', users: ['c', 'me'], status: 'pending', requester: 'me' },
      { id: '4', users: ['me'], status: 'accepted' },
    ]);
    expect([...s.friends]).toEqual(['a']);
    expect(s.incoming).toEqual([{ id: '2', uid: 'b', name: 'Bee' }]);
    expect([...s.outgoing]).toEqual(['c']);
    expect(friendsModule.friendshipId('zed', 'amy')).toBe('amy_zed');
  });
});
