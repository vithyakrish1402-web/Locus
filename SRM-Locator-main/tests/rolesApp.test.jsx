// @vitest-environment jsdom
//
// Items 12, 13 and 14 of the 2026-10 bug batch in the real App.jsx: what the Group Lead (admin),
// a moderator and a member each see and can do (the server enforces it: groupRoles.e2e.test.js),
// the waiting-to-join count and its one notice per burst, the activity log with Export, and the
// blocked list with Unblock.
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
const exported = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve('shared')) }));
vi.mock('../src/utils/activityLogExport.js', async (importOriginal) => ({
  ...(await importOriginal()),
  exportActivityLog: exported.fn,
}));
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
const { ROLE_REFUSED, ACTIVITY_LOG, MEMBER_OPTIONS } = await import('../src/copy/group.js');
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
  exported.fn.mockClear();
});

const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event);
const answer = (event, reply) => act(() => emitted(event).at(-1)[2](reply));
const openGroup = () => fireEvent.click(tabBar().getByRole('button', { name: /Group/ }));
const groupTabBadge = () => within(tabBar().getByRole('button', { name: /Group/ })).queryByLabelText(/waiting/);
const request = (n) => act(() => fakeSocket.receive('access-request', { targetId: `j${n}`, name: `Joiner ${n}`, roomCode: code }));
// Bravo as the server lists them, with a role.
const bravoAs = (role) => act(() => fakeSocket.receive('users-update', { 'sock-Bravo': { ...bravo()['sock-Bravo'], role } }));

// This phone as a moderator: let in as a member, then told its role.
const asModerator = async () => {
  await onTheMap();
  act(() => fakeSocket.receive('demoted-to-member', { roomCode: code }));
  act(() => fakeSocket.receive('group-role', { roomCode: code, role: 'moderator', moderatorIds: ['self-socket'] }));
};
const asMember = async () => {
  await onTheMap();
  act(() => fakeSocket.receive('demoted-to-member', { roomCode: code }));
  act(() => fakeSocket.receive('group-role', { roomCode: code, role: 'member', moderatorIds: [] }));
};

describe('the Group Lead', () => {
  it('has Admit all in Join requests, with two or more waiting', async () => {
    await onTheMap();
    request(1);
    request(2);
    openGroup();
    fireEvent.click(screen.getByRole('button', { name: /Join requests/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Admit all 2' }));
    expect(emitted('admit-all').at(-1)[1]).toEqual({ roomCode: code });
  });

  it('can remove, remove and block, and make a member a moderator', async () => {
    await onTheMap();
    bravoAs('member');
    openGroup();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
    fireEvent.click(await screen.findByText(MEMBER_OPTIONS.makeModerator));
    expect(emitted('set-moderator').at(-1)[1]).toEqual({ roomCode: code, targetId: 'sock-Bravo', moderator: true });

    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
    fireEvent.click(await screen.findByText(MEMBER_OPTIONS.remove));
    fireEvent.click(within(await screen.findByTestId('remove-confirm')).getByRole('button', { name: 'Remove' }));
    expect(emitted('kick-member').at(-1)[1]).toEqual({ roomCode: code, targetId: 'sock-Bravo' });
    // Refused by the server: said so.
    answer('kick-member', { ok: false, reason: 'not-allowed' });
    expect(noticeUp(ROLE_REFUSED)).toBe(true);
  });

  it('can take a moderator back to member', async () => {
    await onTheMap();
    bravoAs('moderator');
    openGroup();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
    fireEvent.click(await screen.findByText(MEMBER_OPTIONS.removeModerator));
    expect(emitted('set-moderator').at(-1)[1]).toMatchObject({ moderator: false });
  });
});

describe('a moderator', () => {
  it('has Join requests, the log and the blocked list, but not the Lead-only tools', async () => {
    await asModerator();
    openGroup();
    expect(screen.getByRole('button', { name: /Join requests/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activity log' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Blocked people' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Refresh locations/ })).toBeNull();
    expect(screen.queryByTestId('sos-controls')).toBeNull();
  });

  it('has no Admit all', async () => {
    await asModerator();
    request(1);
    request(2);
    openGroup();
    fireEvent.click(screen.getByRole('button', { name: /Join requests/ }));
    await screen.findByTestId('join-requests');
    expect(screen.queryByRole('button', { name: /Admit all/ })).toBeNull();
    // Approving one still works.
    fireEvent.click(screen.getByRole('button', { name: 'Approve Joiner 1' }));
    expect(emitted('resolve-access').at(-1)[1]).toEqual({ targetId: 'j1', roomCode: code, approved: true });
  });

  it('can remove a member but not another moderator, and nobody can remove the Group Lead', async () => {
    await asModerator();
    bravoAs('member');
    openGroup();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
    expect(await screen.findByText(MEMBER_OPTIONS.remove)).toBeTruthy();
    expect(screen.queryByText(MEMBER_OPTIONS.makeModerator)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    for (const role of ['moderator', 'admin']) {
      bravoAs(role);
      fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
      await screen.findByTestId('member-options');
      expect(screen.queryByText(MEMBER_OPTIONS.remove)).toBeNull();
      expect(screen.queryByText(MEMBER_OPTIONS.removeAndBlock)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    }
  });
});

describe('a member', () => {
  it('has none of the Lead tools, no waiting count, and no removing', async () => {
    await asMember();
    request(1);
    act(() => fakeSocket.receive('join-requests-waiting', { roomCode: code, count: 1 }));
    expect(groupTabBadge()).toBeNull();
    expect(noticeUp(NOTICES.joinWaiting(1))).toBe(false);
    openGroup();
    expect(screen.queryByTestId('lead-tools')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Options for Bravo' }));
    await screen.findByTestId('member-options');
    expect(screen.queryByText(MEMBER_OPTIONS.remove)).toBeNull();
  });
});

describe('people waiting to join', () => {
  it('show as a count on Group for whoever may let them in, and the count drops as they are dealt with', async () => {
    await asModerator();
    request(1);
    request(2);
    request(3);
    expect(groupTabBadge().textContent).toBe('3');
    act(() => fakeSocket.receive('access-request-withdrawn', { targetId: 'j2', roomCode: code }));
    expect(groupTabBadge().textContent).toBe('2');
  });

  it('are announced in one notice per burst, which opens Join requests', async () => {
    await onTheMap();
    request(1);
    request(2);
    request(3);
    expect(feed.filter((n) => /waiting to join/.test(n.message))).toHaveLength(0);
    act(() => fakeSocket.receive('join-requests-waiting', { roomCode: code, count: 3 }));
    const notices = feed.filter((n) => /waiting to join/.test(n.message));
    expect(notices.map((n) => n.message)).toEqual([NOTICES.joinWaiting(3)]);
    act(() => notices[0].onClick());
    expect(await screen.findByTestId('join-requests')).toBeTruthy();
  });
});

describe('the activity log', () => {
  const entry = (at, kind, name) => ({ at, kind, uid: `u-${name}`, name });

  it('shows what the server keeps, newest first, follows it live, and exports it', async () => {
    await asModerator();
    openGroup();
    fireEvent.click(screen.getByRole('button', { name: 'Activity log' }));
    expect(emitted('get-activity-log').at(-1)[1]).toEqual({ roomCode: code });
    answer('get-activity-log', { ok: true, log: [entry(1000, 'went-hidden', 'Bravo'), entry(2000, 'back-from-hidden', 'Bravo')] });
    act(() => fakeSocket.receive('activity-entry', { roomCode: code, entry: entry(3000, 'left-group', 'Charlie') }));
    const rows = screen.getAllByTestId('activity-entry').map((r) => r.textContent);
    expect(rows[0]).toContain('Charlie left the group');
    expect(rows[2]).toContain('Bravo hid their location');
    fireEvent.click(screen.getByRole('button', { name: ACTIVITY_LOG.export }));
    expect(exported.fn).toHaveBeenCalledTimes(1);
    expect(exported.fn.mock.calls[0][0]).toHaveLength(3);
    expect(exported.fn.mock.calls[0][1]).toBe(code);
  });

  it('says so when the export could only be copied', async () => {
    exported.fn.mockImplementationOnce(() => Promise.resolve('copied'));
    await onTheMap();
    openGroup();
    fireEvent.click(screen.getByRole('button', { name: 'Activity log' }));
    answer('get-activity-log', { ok: true, log: [entry(1000, 'kicked', 'Bravo')] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ACTIVITY_LOG.export })); });
    expect(noticeUp(ACTIVITY_LOG.copied)).toBe(true);
  });
});

describe('blocked people', () => {
  it('are listed for the Group Lead and moderators, who can unblock them', async () => {
    await asModerator();
    openGroup();
    fireEvent.click(screen.getByRole('button', { name: 'Blocked people' }));
    answer('get-blocked', { ok: true, blocked: [{ uid: 'u-X', name: 'Xray' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Unblock Xray' }));
    expect(emitted('unblock-user').at(-1)[1]).toEqual({ roomCode: code, uid: 'u-X' });
    answer('unblock-user', { ok: true, blocked: [] });
    expect(await screen.findByTestId('blocked-empty')).toBeTruthy();
  });
});

describe('being removed', () => {
  it('says the person can ask to join again when they were removed, not blocked', async () => {
    await asMember();
    act(() => fakeSocket.receive('exiled', { reason: 'kicked' }));
    expect(noticeUp(NOTICES.removedKicked)).toBe(true);
  });
});
