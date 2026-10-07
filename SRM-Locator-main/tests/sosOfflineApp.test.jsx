// @vitest-environment jsdom
//
// An Emergency alert sent while offline, in the real App.jsx (a fix, 2026-10-07; the server
// side of the bug is in sosOffline.e2e.test.js). Held until this phone is back in its group,
// sent once, never called "sent" while it waits, and let go of with a notice if the group is
// gone. Online, the button behaves exactly as it always did.
//
// Only the socket transport, Firebase, native plugins, maps and the update hooks are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

// Notices leave at once, so a dismissed one is gone from the page.
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
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
    timeout: () => ({ emit: vi.fn() }),
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
const { __resetNotifications, subscribe } = await import('../src/utils/notify.js');
// What the notice feed holds (the page's copy can lag behind on its exit animation).
let feed = [];
subscribe((items) => { feed = items; });
const noticeUp = (text) => feed.some((n) => n.message === text || n.body === text);
const { SOS_HELD, SOS_SENT, SOS_DROPPED } = await import('../src/copy/emergency.js');

const A = { lat: 12.8230, lng: 80.0440 };
const B = { lat: 12.8260, lng: 80.0470 };
const near = (p, spot) => Math.abs(p.lat - spot.lat) < 0.0002 && Math.abs(p.lng - spot.lng) < 0.0002;
const sent = () => fakeSocket.emit.mock.calls.filter(([e]) => e === 'sos-broadcast').map(([, p]) => p);
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const button = () => screen.getByRole('button', { name: /SOS beacon|Emergency alert waiting/ });

let watchCallback = null;
const standAt = (spot) => act(async () => {
  for (let i = 0; i < 12; i += 1) {
    await watchCallback({ coords: { latitude: spot.lat, longitude: spot.lng, speed: 0 } });
  }
});

let code;
const inGroupAt = async (spot) => {
  navigator.geolocation.getCurrentPosition.mockImplementation((ok) => ok({ coords: { latitude: spot.lat, longitude: spot.lng, speed: 0 } }));
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
  await standAt(spot);
};

// The full gesture: hold 1.2 s, let go, hold 1.2 s again.
const holdTwice = () => {
  fireEvent.pointerDown(button(), { button: 0 });
  advance(1200);
  fireEvent.pointerUp(button(), { button: 0 });
  fireEvent.pointerDown(button(), { button: 0 });
  advance(1200);
  fireEvent.pointerUp(button(), { button: 0 });
};

const goOffline = () => {
  fakeSocket.connected = false;
  act(() => fakeSocket.receive('disconnect', 'transport close'));
};
const backOnline = () => {
  fakeSocket.connected = true;
  act(() => fakeSocket.receive('connect'));
};
const letBackIn = () => act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
// What the button shows: 'idle' (SOS), 'fired' (Sent), 'held' (Waiting for connection)...
const label = () => button().dataset.view;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  fakeSocket.connected = true;
  watchCallback = null;
  __resetNotifications();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn((cb) => { watchCallback = cb; return 1; }),
      clearWatch: vi.fn(),
    },
  });
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete navigator.vibrate;
});

describe('online: exactly as before', () => {
  it('one sos-broadcast at the end of the second hold, same payload, Sent for 2 s, no buzz', async () => {
    await inGroupAt(A);
    fakeSocket.emit.mockClear();
    fireEvent.pointerDown(button(), { button: 0 });
    advance(1200);
    fireEvent.pointerUp(button(), { button: 0 });
    fireEvent.pointerDown(button(), { button: 0 });
    advance(1199);
    expect(sent()).toHaveLength(0);
    advance(1);
    expect(sent()).toHaveLength(1);
    expect(Object.keys(sent()[0]).sort()).toEqual(['lat', 'lng', 'roomCode', 'senderName', 'timestamp']);
    expect(sent()[0]).toMatchObject({ roomCode: code, senderName: 'Alpha' });
    expect(near(sent()[0], A)).toBe(true);
    // Nothing else went out with it.
    expect(fakeSocket.emit.mock.calls.map(([e]) => e).filter((e) => !['update-location', 'safety-ping', 'check-ping'].includes(e))).toEqual(['sos-broadcast']);
    expect(label()).toBe('fired');
    expect(navigator.vibrate).not.toHaveBeenCalled();
    // E3: a quiet "sent" notice, posted without a buzz of its own.
    expect(noticeUp(SOS_HELD.title)).toBe(false);
    expect(feed.find((n) => n.message === SOS_SENT.title)?.body).toContain(SOS_SENT.withLocation);
    advance(1999);
    expect(label()).toBe('fired');
    advance(1);
    expect(label()).toBe('idle');
  });
});

describe('offline: held until back in the group', () => {
  it('is not sent while offline, and never called "sent" while it waits', async () => {
    await inGroupAt(A);
    goOffline();
    fakeSocket.emit.mockClear();
    holdTwice();
    expect(sent()).toHaveLength(0);
    expect(label()).toBe('held');
    expect(button().getAttribute('aria-label')).toMatch(/^Emergency alert waiting for connection/);
    // On the button, and as a notice.
    expect(screen.getAllByText(SOS_HELD.title)).toHaveLength(2);
    expect(screen.getByText(SOS_HELD.body)).toBeTruthy();
    expect(feed.find((n) => n.message === SOS_HELD.title)).toMatchObject({ severity: 'warning', duration: 0 });
    // It stays, and nothing anywhere says "sent", however long it waits.
    for (let i = 0; i < 6; i += 1) {
      advance(10000);
      expect(document.body.textContent).not.toMatch(/\bsent\b/i);
      expect(label()).toBe('held');
      expect(noticeUp(SOS_HELD.title)).toBe(true);
    }
  });

  it('is not sent on reconnect alone, only once the server lets this phone back into the group', async () => {
    await inGroupAt(A);
    goOffline();
    fakeSocket.emit.mockClear();
    holdTwice();
    backOnline();
    expect(sent()).toHaveLength(0);
    expect(label()).toBe('held');
    letBackIn();
    expect(sent()).toHaveLength(1);
    expect(near(sent()[0], A)).toBe(true);
    expect(sent()[0]).toMatchObject({ roomCode: code, senderName: 'Alpha' });
    expect(noticeUp(SOS_HELD.title)).toBe(false);
    expect(feed.find((n) => n.message === SOS_SENT.title)?.body).toContain(SOS_SENT.late);
    expect(label()).toBe('idle');
  });

  it('pressed after reconnecting but before the server lets it back in: held too, not sent', async () => {
    await inGroupAt(A);
    goOffline();
    backOnline();
    fakeSocket.emit.mockClear();
    holdTwice();
    expect(sent()).toHaveLength(0);
    expect(label()).toBe('held');
    letBackIn();
    expect(sent()).toHaveLength(1);
  });

  it('survives a second drop before it is delivered, and goes once', async () => {
    await inGroupAt(A);
    goOffline();
    fakeSocket.emit.mockClear();
    holdTwice();
    backOnline();
    goOffline();
    backOnline();
    expect(sent()).toHaveLength(0);
    letBackIn();
    letBackIn();
    expect(sent()).toHaveLength(1);
  });

  it('one alert at a time: used again while held, it keeps one alert with the freshest location', async () => {
    await inGroupAt(A);
    goOffline();
    fakeSocket.emit.mockClear();
    holdTwice();
    await standAt(B);
    holdTwice();
    expect(label()).toBe('held');
    backOnline();
    letBackIn();
    expect(sent()).toHaveLength(1);
    expect(near(sent()[0], B)).toBe(true);
  });

  it('the group gone on reconnect: dropped, an amber notice that stays, and the button back to normal', async () => {
    await inGroupAt(A);
    goOffline();
    fakeSocket.emit.mockClear();
    holdTwice();
    backOnline();
    act(() => fakeSocket.receive('squad-not-found', { roomCode: code }));
    expect(sent()).toHaveLength(0);
    expect(screen.getByText(SOS_DROPPED.gone)).toBeTruthy();
    expect(noticeUp(SOS_HELD.title)).toBe(false);
    advance(60000);
    expect(noticeUp(SOS_DROPPED.gone)).toBe(true);
    expect(feed.find((n) => n.message === SOS_DROPPED.gone)).toMatchObject({ severity: 'warning', duration: 0 });
    // Back in a group later: nothing old goes out.
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    letBackIn();
    expect(sent()).toHaveLength(0);
  });

  it('leaving the group while it waits lets go of it, with its own notice', async () => {
    await inGroupAt(A);
    goOffline();
    fakeSocket.emit.mockClear();
    holdTwice();
    backOnline();
    act(() => fakeSocket.receive('squad-code-taken', { roomCode: code }));
    expect(screen.getByText(SOS_DROPPED.left)).toBeTruthy();
    expect(sent()).toHaveLength(0);
  });
});

// E3: what the sender is told once an alert has gone (never before), with no buzz of its own.
describe('the sender is told once it has gone', () => {
  it('with a location: sent to your group, with the last known location', async () => {
    await inGroupAt(A);
    holdTwice();
    const notice = feed.find((n) => n.message === SOS_SENT.title);
    expect(notice).toMatchObject({ severity: 'success', body: SOS_SENT.withLocation });
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it('without a fix: "Alert sent, but without your location", in amber', async () => {
    navigator.geolocation.getCurrentPosition.mockImplementation((_ok, fail) => fail?.({ code: 3 }));
    render(<App />);
    code = document.querySelector('.sr-only').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
    await act(async () => {});
    fakeSocket.emit.mockClear();
    holdTwice();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ lat: null, lng: null });
    const notice = feed.find((n) => n.message === SOS_SENT.noLocationTitle);
    expect(notice).toMatchObject({ severity: 'warning', body: SOS_SENT.noLocation });
    expect(noticeUp(SOS_SENT.title)).toBe(false);
  });

  it('while Paused: says sharing is still paused', async () => {
    await inGroupAt(A);
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Paused' }));
    holdTwice();
    expect(feed.find((n) => n.message === SOS_SENT.title)?.body).toBe(`${SOS_SENT.withLocation} ${SOS_SENT.stillPaused}`);
  });

  it('while Hidden: says sharing is still hidden', async () => {
    await inGroupAt(A);
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hidden' }));
    holdTwice();
    expect(feed.find((n) => n.message === SOS_SENT.title)?.body).toBe(`${SOS_SENT.withLocation} ${SOS_SENT.stillHidden}`);
  });
});
