// @vitest-environment jsdom
//
// SYNC_TELEMETRY, the Commander's button for the squad's telemetry matrix (the server half
// is in telemetrySync.e2e.test.js).
//
// It never touched location. It was a bare socket emit with no timeout and no error
// state, so whenever the server said nothing (a squad it no longer had, a socket it didn't
// have down as Commander) or the socket was mid-reconnect, a tap did nothing at all. When
// the telemetry did arrive, one member with a GPS fix but no heartbeat yet crashed the
// whole app. And on a phone, the tap often never reached it: when location failed, the
// persistent "LOCATION ACCESS DENIED" banner was drawn on top of the SQUAD panel, over
// SYNC_TELEMETRY and NODE_ACCESS, and swallowed the taps. That banner also said ACCESS
// DENIED for any failure, a GPS timeout indoors included.
//
// Renders the real App.jsx; only the socket transport, Firebase, native plugins, maps
// and the update hooks are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';
import { LAYER } from '../src/utils/layers.js';

const fakeSocket = vi.hoisted(() => {
  const handlers = new Map();
  const socket = {
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
    // Emits made with an acknowledgement, awaiting a reply or a timeout: { event, args, ms, ack }.
    acks: [],
  };
  // socket.timeout(ms).emit(event, ...args, ack), as socket.io-client does it.
  socket.timeout = (ms) => ({
    emit: (event, ...args) => {
      const ack = args.pop();
      socket.emit(event, ...args);
      socket.acks.push({ event, args, ms, ack });
    },
  });
  return socket;
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

const syncRequests = () => fakeSocket.emit.mock.calls.filter(([event]) => event === 'request-telemetry');
const lastAck = () => fakeSocket.acks.filter((a) => a.event === 'request-telemetry').at(-1)?.ack;
// The Group Lead's Refresh locations (the old SYNC_TELEMETRY), and Retry on its notice.
const syncButton = () => screen.getByRole('button', { name: /^(Refresh locations|Refreshing…)$/ });
const retryButton = () => within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' });
const matrixOpen = () => Boolean(screen.queryByText('SYS_TELEMETRY // MATRIX'));

// Signed in -> lobby -> INITIALIZE -> the SQUAD panel, where the Commander's buttons are.
let squadCode;
const commanderOnSquadPanel = () => {
  render(<App />);
  squadCode = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: squadCode }));
  fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
};

const withMember = (id, extra = {}) =>
  act(() => fakeSocket.receive('users-update', {
    [id]: { uid: 'u-bravo', name: 'Bravo', roomCode: squadCode, lat: 12.8235, lng: 80.0446, speed: 0, heading: 0, battery: 90, ...extra },
  }));

let geolocationError = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  fakeSocket.acks.length = 0;
  fakeSocket.connected = true;
  geolocationError = null;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((_ok, fail) => { if (geolocationError) fail(geolocationError); }),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete navigator.geolocation;
});

describe('SYNC_TELEMETRY', () => {
  it('shows it is working, and opens the matrix when the telemetry arrives', () => {
    commanderOnSquadPanel();
    fireEvent.click(syncButton());

    expect(syncRequests().at(-1)).toEqual(['request-telemetry', squadCode]);
    expect(syncButton().textContent).toMatch(/Refreshing/);
    expect(syncButton().disabled).toBe(true);

    act(() => fakeSocket.receive('telemetry-sync-complete', {}));
    act(() => lastAck()(null, { ok: true }));
    expect(matrixOpen()).toBe(true);
  });

  it('says so, and offers a retry, when the server does not answer', () => {
    commanderOnSquadPanel();
    fireEvent.click(syncButton());
    act(() => lastAck()(new Error('operation has timed out')));

    expect(screen.getByRole('alert').textContent).toMatch(/no answer from the server/i);
    fireEvent.click(retryButton());
    expect(syncRequests()).toHaveLength(2);
  });

  it('says why when the server refuses', () => {
    commanderOnSquadPanel();
    fireEvent.click(syncButton());
    act(() => lastAck()(null, { ok: false, reason: 'not-owner' }));
    expect(screen.getByRole('alert').textContent).toMatch(/only the group lead/i);

    fireEvent.click(syncButton());
    act(() => lastAck()(null, { ok: false, reason: 'not-in-squad' }));
    expect(screen.getByRole('alert').textContent).toMatch(/no record of this group/i);
  });

  it('says so straight away when there is no connection, instead of queueing the request', () => {
    commanderOnSquadPanel();
    fakeSocket.connected = false;
    fireEvent.click(syncButton());

    expect(syncRequests()).toEqual([]);
    expect(screen.getByRole('alert').textContent).toMatch(/not connected/i);
  });

  it('is settled by the telemetry itself, from a server that sends no acknowledgement', () => {
    commanderOnSquadPanel();
    fireEvent.click(syncButton());
    act(() => fakeSocket.receive('telemetry-sync-complete', {}));
    act(() => lastAck()(new Error('operation has timed out'))); // the old server never acks

    expect(matrixOpen()).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the telemetry matrix', () => {
  it("shows a member whose only fix is a GPS report, instead of crashing the app", () => {
    commanderOnSquadPanel();
    withMember('sock-bravo');
    fireEvent.click(syncButton());
    // What a server without normalised records sends before the member's first heartbeat.
    act(() => fakeSocket.receive('telemetry-sync-complete', {
      'sock-bravo': { lat: 12.8235, lng: 80.0446, speed: 0, heading: 0, battery: 90, lastSeen: Date.now() },
    }));

    expect(matrixOpen()).toBe(true);
    expect(screen.getByText(/12\.82350/)).toBeTruthy();
  });

  it('shows an unknown battery in grey, not the green of a healthy one', () => {
    commanderOnSquadPanel();
    withMember('sock-bravo');
    act(() => fakeSocket.receive('users-update', {
      'sock-bravo': { uid: 'u-bravo', name: 'Bravo', roomCode: squadCode, lat: 12.8235, lng: 80.0446, battery: 90 },
      'sock-charlie': { uid: 'u-charlie', name: 'Charlie', roomCode: squadCode, lat: 12.8236, lng: 80.0447, battery: 50 },
      'sock-delta': { uid: 'u-delta', name: 'Delta', roomCode: squadCode, lat: 12.8237, lng: 80.0448, battery: 50 },
      'sock-echo': { uid: 'u-echo', name: 'Echo', roomCode: squadCode, lat: 12.8238, lng: 80.0449, battery: 50 },
    }));
    fireEvent.click(syncButton());
    const at = { latitude: 12.9, longitude: 80.1, timestamp: new Date().toISOString() };
    act(() => fakeSocket.receive('telemetry-sync-complete', {
      'sock-bravo': { ...at, batteryLevel: null }, // no reading at all
      'sock-charlie': { ...at, batteryLevel: 'Unknown' }, // an older server's placeholder
      'sock-delta': { ...at, batteryLevel: '77%' },
      'sock-echo': { ...at, batteryLevel: '15%' },
    }));

    // The matrix row for a member (their name also appears in the squad roster behind it).
    const power = (name) => screen.getAllByText(name).map((el) => el.closest('[class*="md:grid-cols-4"]')).find(Boolean).children[2];
    expect(power('Bravo').textContent).toMatch(/UNKNOWN$/);
    expect(power('Bravo').className).toContain('text-zinc-500');
    expect(power('Bravo').className).not.toContain('emerald');
    expect(power('Charlie').textContent).toMatch(/UNKNOWN$/);
    expect(power('Charlie').className).toContain('text-zinc-500');
    expect(power('Delta').textContent).toMatch(/77%$/);
    expect(power('Delta').className).toContain('text-emerald-500');
    expect(power('Echo').textContent).toMatch(/15%$/);
    expect(power('Echo').className).toContain('text-red-500');
  });

  it('says so when nobody else is in the squad yet, rather than showing an empty table', () => {
    commanderOnSquadPanel();
    fireEvent.click(syncButton());
    act(() => fakeSocket.receive('telemetry-sync-complete', {}));
    expect(screen.getByText(/no other operatives/i)).toBeTruthy();
  });

  it('refreshes every 5 seconds while it is open, as its footer says', () => {
    commanderOnSquadPanel();
    fireEvent.click(syncButton());
    act(() => fakeSocket.receive('telemetry-sync-complete', {}));
    act(() => lastAck()(null, { ok: true }));
    const before = syncRequests().length;

    act(() => vi.advanceTimersByTime(5000));
    expect(syncRequests().length).toBe(before + 1);

    // Closed: no more.
    fireEvent.click(screen.getByText('SYS_TELEMETRY // MATRIX').closest('.p-6').querySelector('button'));
    const afterClose = syncRequests().length;
    act(() => vi.advanceTimersByTime(15000));
    expect(syncRequests().length).toBe(afterClose);
  });
});

describe('the telemetry matrix after leaving the squad', () => {
  it("does not reappear, with the old squad's data, in the next squad", () => {
    commanderOnSquadPanel();
    fireEvent.click(syncButton());
    act(() => fakeSocket.receive('telemetry-sync-complete', {}));
    expect(matrixOpen()).toBe(true);

    // Put out of the squad while the matrix is up (it covers the whole screen, so this is
    // how it happens: a block or a mutiny vote, not a tap), then into a new one.
    act(() => fakeSocket.receive('exiled', { reason: 'blocked' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Create a group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    expect(matrixOpen()).toBe(false);
  });
});

describe('the location banner', () => {
  it('lets taps through to the SQUAD panel beneath it: only its dismiss button takes them', async () => {
    geolocationError = { code: 1, message: 'User denied Geolocation' };
    commanderOnSquadPanel();
    const banner = await screen.findByTestId('location-problem');

    // jsdom has no layout, so this checks the classes that decide it. (Measured in a real
    // browser at 412 px: the banner used to cover the top third of SYNC_TELEMETRY.)
    expect(banner.className).not.toMatch(/pointer-events-auto/);
    expect(screen.getByTitle('Dismiss').className).toMatch(/pointer-events-auto/);
    // And on a phone the whole stack sits under the open SQUAD panel (z-[900]), letting taps
    // through.
    const stack = screen.getByTestId('map-top-stack');
    expect(stack.className).toMatch(/z-\[850\] md:z-\[1000\]/);
    expect(stack.className).toMatch(/pointer-events-none/);
  });


  it('says location is off only when it was refused, and that it can\'t find you when there is just no fix', async () => {
    geolocationError = { code: 3, message: 'Timeout expired' };
    commanderOnSquadPanel();
    const card = await screen.findByTestId('location-problem');
    expect(card.dataset.kind).toBe('no-fix');
    expect(card.textContent).toContain("Can't find your location");
    expect(screen.queryByText('Location is off')).toBeNull();
  });

  it('is amber, never red', async () => {
    geolocationError = { code: 1, message: 'User denied Geolocation' };
    commanderOnSquadPanel();
    const card = await screen.findByTestId('location-problem');
    expect(card.textContent).toContain('Location is off');
    expect(card.outerHTML).toMatch(/text-warning/);
    expect(card.outerHTML).not.toMatch(/red-|danger/);
  });
});

// Notifications (the ping and a member's lost connection among them) and the open group
// panel. On a phone the open panel holds the Group Lead's Refresh locations (SYNC_TELEMETRY)
// and Join requests (NODE_ACCESS) buttons, near the top, where notices drop in. So while it
// is open the whole feed sits under it (LAYER.underGroupPanel, below the panel's z-[900]) and
// takes no taps; a notice takes taps again only once it is wholly above the panel's top edge.
// Over AR Scan, and with the panel closed, the feed is on top. (jsdom has no layout or hit
// testing, so this checks what decides it: the feed's layer and each notice's pointer-events.)
describe('notifications and the open group panel on a phone', () => {
  // A phone-sized screen (useIsMobile asks matchMedia for max-width).
  let realMatchMedia;
  beforeEach(() => {
    realMatchMedia = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => { window.matchMedia = realMatchMedia; });

  const feed = () => screen.getByTestId('comms-feed');
  // The phone's bottom bar SQUAD, which opens the panel as a sheet.
  const openPanel = () => {
    commanderOnSquadPanel();
    const bar = within(screen.getByRole('navigation', { name: 'Main' }));
    if (bar.getByRole('button', { name: 'Group' }).getAttribute('aria-current') !== 'page') fireEvent.click(bar.getByRole('button', { name: 'Group' }));
  };
  const pingNotice = () => screen.getByText('Bravo is pinging you').closest('[data-severity]');
  const panelZ = () => Number(/(?:^|\s)z-\[(\d+)\]/.exec(screen.getByRole('button', { name: /Refresh locations/ }).closest('[class*="z-[900]"]').className)[1]);
  const passesTaps = (el) => {
    for (let node = el; node; node = node.parentElement) {
      if (/(?:^|\s)pointer-events-auto\b/.test(node.className)) return false;
      if (/(?:^|\s)pointer-events-none\b/.test(node.className)) return true;
    }
    return false;
  };

  it("a ping while the panel is open sits under it and doesn't take the Group Lead's taps", () => {
    openPanel();
    act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));

    expect(Number(feed().style.zIndex)).toBe(LAYER.underGroupPanel);
    expect(LAYER.underGroupPanel).toBeLessThan(panelZ());
    expect(passesTaps(pingNotice())).toBe(true);
    // Its close button too: the notice can't be seen.
    expect(passesTaps(within(pingNotice()).getByRole('button', { name: 'Dismiss notice' }))).toBe(true);

    // Both buttons still do their job with the ping up.
    fireEvent.click(syncButton());
    expect(syncRequests()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Join requests/ }));
    expect(screen.getByRole('dialog', { name: 'Join requests' })).toBeTruthy();
  });

  it('a notice wholly above the panel (the panel dragged down) can be closed again', () => {
    const rects = { panel: 500, notice: [100, 180] };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.dataset?.severity) return { top: rects.notice[0], bottom: rects.notice[1], height: rects.notice[1] - rects.notice[0], left: 0, right: 0, width: 0 };
      return { top: rects.panel, bottom: 800, height: 300, left: 0, right: 0, width: 0 };
    });
    openPanel();
    act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));
    act(() => vi.advanceTimersByTime(200));
    expect(pingNotice().dataset.reachable).toBe('true');
    expect(passesTaps(pingNotice())).toBe(false);

    // The panel comes back up over it: covered again.
    rects.panel = 120;
    act(() => vi.advanceTimersByTime(200));
    expect(passesTaps(pingNotice())).toBe(true);
  });

  it('with the panel closed the feed is on top again', () => {
    openPanel();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Map' }));
    act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));
    expect(Number(feed().style.zIndex)).toBe(LAYER.toast);
    expect(passesTaps(pingNotice())).toBe(false);
  });
});
