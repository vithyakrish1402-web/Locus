// @vitest-environment jsdom
//
// Keeping sharing when the app is closed, through the real App.jsx with a fake LocusBackground plugin
// and a fake server: when the switch exists at all, the consent step before anything else, the order
// of the steps, the state line, and what stops it. The native half has its own tests (android/app/src).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { BACKGROUND_SHARING } from '../src/copy/settings.js';
import { SOS_RECEIVED } from '../src/copy/emergency.js';
import { consentFingerprint } from '../src/utils/backgroundConsent.js';

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

// The plugin, as the shell would have it. `order` records every call, to show what happens first.
const plugin = vi.hoisted(() => {
  const listeners = [];
  const order = [];
  const p = {
    listeners,
    order,
    caps: { version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false },
    lastState: { running: false, state: 'stopped' },
    getCapabilities: vi.fn(async () => p.caps),
    getState: vi.fn(async () => p.lastState),
    requestPermissions: vi.fn(async () => { order.push('permissions'); }),
    start: vi.fn(async () => { order.push('start'); return { started: true, persisted: true }; }),
    stop: vi.fn(async () => { order.push('stop'); }),
    acknowledgeStop: vi.fn(async () => {}),
    sosShown: vi.fn(async () => {}),
    acknowledgeSos: vi.fn(async () => {}),
    setSosAlerts: vi.fn(async () => {}),
    addListener: vi.fn(async (_event, fn) => {
      listeners.push(fn);
      return { remove: () => { listeners.splice(listeners.indexOf(fn), 1); } };
    }),
  };
  return p;
});
const shell = vi.hoisted(() => ({ hasPlugin: true }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({
  auth: { currentUser: { getIdToken: async () => 'id-token-123' } },
  googleProvider: {},
  db: {},
}));
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
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: (name) => name === 'LocusBackground' && shell.hasPlugin },
  registerPlugin: (name) => (name === 'LocusBackground' ? plugin : {}),
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
// A stop makes the next start wait a few seconds (STOP_SETTLE_MS); each test starts without one.
const { forgetLastStopForTests } = await import('../src/utils/backgroundSharing.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
// The switch and consent are the signed-in account's own (u-self here): src/utils/backgroundConsent.js.
const SWITCH_KEY = 'locus.backgroundSharing:u-self';
const CONSENT_KEY = 'locus.backgroundSharingConsent:u-self';
const COPY = BACKGROUND_SHARING;
let code;
let server;
let fetchMock;

const goodToken = () => ({ token: 'v1.payload.mac', expiresAt: Date.now() + 14 * 86_400_000, ttlSeconds: 1209600 });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const renderApp = async () => {
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  await flush();
};
const intoGroup = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await flush();
};
const openSettings = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
  await waitFor(() => screen.getByTestId('settings'));
};
const section = () => screen.getByTestId('background-sharing');
const theSwitch = () => within(section()).getByRole('switch');
const stateText = () => screen.getByTestId('background-sharing-state').textContent;
const consentSheet = () => screen.queryByTestId('background-sharing-consent');
const tokenRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/background/token'));

beforeEach(() => {
  forgetLastStopForTests();
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  for (const fn of [plugin.getCapabilities, plugin.getState, plugin.requestPermissions, plugin.start, plugin.stop, plugin.acknowledgeStop, plugin.addListener, plugin.sosShown, plugin.acknowledgeSos, plugin.setSosAlerts]) fn.mockClear();
  plugin.requestPermissions.mockImplementation(async () => { plugin.order.push('permissions'); });
  plugin.listeners.length = 0;
  plugin.order.length = 0;
  plugin.caps = { version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false };
  plugin.lastState = { running: false, state: 'stopped' };
  shell.hasPlugin = true;
  server = { status: { code: 200, body: { available: true } }, token: { code: 200, body: null } };
  fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/api/background/status')) return { status: server.status.code, json: async () => server.status.body };
    if (u.endsWith('/api/background/token')) {
      plugin.order.push('mint');
      return { status: server.token.code, json: async () => server.token.body ?? goodToken() };
    }
    return { status: 404, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  try { localStorage.removeItem(SWITCH_KEY); localStorage.removeItem(CONSENT_KEY); } catch { /* no storage */ }
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
  vi.unstubAllGlobals();
  delete navigator.geolocation;
});

describe('when the switch exists', () => {
  it('shows it, off, when the app has the service and the server has it on', async () => {
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    expect(within(section()).getByText(COPY.switchLabel)).toBeTruthy();
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
    expect(stateText()).toBe('Not sharing');
    expect(plugin.start).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
  });

  it('asks the server with no sign-in', async () => {
    await renderApp();
    await flush();
    const status = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/background/status'));
    expect(status.length).toBeGreaterThan(0);
    expect(status[0][0]).toBe('https://locus-1-896t.onrender.com/api/background/status');
    expect(status[0][1].headers).toBeUndefined();
  });

  it('is absent without the service in the app', async () => {
    shell.hasPlugin = false;
    await renderApp();
    await intoGroup();
    await openSettings();
    await flush();
    expect(screen.queryByTestId('background-sharing')).toBeNull();
    expect(plugin.getCapabilities).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is absent when the service speaks another version', async () => {
    plugin.caps = { ...plugin.caps, version: 2 };
    await renderApp();
    await intoGroup();
    await openSettings();
    await flush();
    expect(screen.queryByTestId('background-sharing')).toBeNull();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/background'))).toHaveLength(0);
  });

  it.each([
    ['says it is off', { code: 200, body: { available: false } }],
    ['answers disabled (an older server, feature off)', { code: 503, body: { error: 'disabled' } }],
    ['has no such route (a server that does not know it yet)', { code: 404, body: {} }],
    ['is down', { code: 500, body: {} }],
  ])('is absent when the server %s', async (_name, answer) => {
    server.status = answer;
    await renderApp();
    await intoGroup();
    await openSettings();
    await flush();
    expect(screen.queryByTestId('background-sharing')).toBeNull();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
  });

  it('is absent when the server cannot be reached', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('offline'); });
    await renderApp();
    await intoGroup();
    await openSettings();
    await flush();
    expect(screen.queryByTestId('background-sharing')).toBeNull();
  });
});

describe('turning it on', () => {
  it('asks for consent first: nothing is requested or started until the person agrees', async () => {
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    fireEvent.click(theSwitch());

    const sheet = await waitFor(() => consentSheet() ?? Promise.reject(new Error('no consent step')));
    expect(sheet.textContent).toContain(COPY.consent.title);
    expect(sheet.textContent).toContain(COPY.consent.body);
    expect(within(sheet).getByRole('button', { name: 'Turn on' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('"Not now" leaves it off and asks nothing', async () => {
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    fireEvent.click(theSwitch());
    fireEvent.click(within(await waitFor(() => consentSheet() ?? Promise.reject(new Error('no consent step')))).getByRole('button', { name: 'Not now' }));
    await flush();
    expect(consentSheet()).toBeNull();
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
  });

  it('"Turn on": consent is remembered, then permissions (when missing), then the token, then the service, in that order', async () => {
    plugin.caps = { ...plugin.caps, notificationsEnabled: false, locationGranted: false };
    plugin.requestPermissions.mockImplementation(async () => {
      plugin.order.push('permissions');
      plugin.caps = { ...plugin.caps, notificationsEnabled: true, locationGranted: true };
    });
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    fireEvent.click(theSwitch());
    fireEvent.click(within(await waitFor(() => consentSheet() ?? Promise.reject(new Error('no consent step')))).getByRole('button', { name: 'Turn on' }));

    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
    expect(plugin.order).toEqual(['permissions', 'mint', 'start']);
    expect(localStorage.getItem(CONSENT_KEY)).toBe(consentFingerprint());
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
    const [[url, init]] = tokenRequests();
    expect(url).toBe('https://locus-1-896t.onrender.com/api/background/token');
    expect(init.headers.authorization).toBe('Bearer id-token-123');
    expect(JSON.parse(init.body)).toEqual({ roomCode: code });
    expect(plugin.start.mock.calls[0][0]).toMatchObject({ roomCode: code, deviceToken: 'v1.payload.mac', pollingMs: 5000 });
  });

  it('the state line reads "Sharing with <Group>" once it runs', async () => {
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    fireEvent.click(theSwitch());
    fireEvent.click(within(await waitFor(() => consentSheet() ?? Promise.reject(new Error('no consent step')))).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(stateText()).toBe(`Sharing with ${code.slice(0, 3)} ${code.slice(3)}`));
  });

  it('the second time there is no consent step', async () => {
    localStorage.setItem(CONSENT_KEY, consentFingerprint());
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    fireEvent.click(theSwitch());
    await flush();
    expect(consentSheet()).toBeNull();
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
  });

  it('consent given to older words is asked for again, and a switch left on does nothing meanwhile', async () => {
    localStorage.setItem(CONSENT_KEY, 'f00dbabe'); // what they agreed to once; the words have changed since
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
    expect(plugin.start).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
    fireEvent.click(theSwitch());
    expect(await waitFor(() => consentSheet() ?? Promise.reject(new Error('no consent step')))).toBeTruthy();
  });

  it('a Group is needed: with the switch left on, it starts when the person is let in, not before', async () => {
    localStorage.setItem(CONSENT_KEY, consentFingerprint());
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    fireEvent.click(screen.getByRole('radio', { name: 'Join a group' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: 'K7M2QX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
    await flush();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
    act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'K7M2QX' }));
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
    expect(plugin.start.mock.calls[0][0].roomCode).toBe('K7M2QX');
  });

  it('notifications refused: nothing starts and the person is told why', async () => {
    plugin.caps = { ...plugin.caps, notificationsEnabled: false };
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    fireEvent.click(theSwitch());
    fireEvent.click(within(await waitFor(() => consentSheet() ?? Promise.reject(new Error('no consent step')))).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(stateText()).toBe(COPY.refused['notifications-denied']));
    expect(plugin.requestPermissions).toHaveBeenCalledWith({ permissions: ['location', 'notifications'] });
    expect(plugin.start).not.toHaveBeenCalled();
    expect(tokenRequests()).toHaveLength(0);
  });

  it('says so when the server switches it off between looking and starting', async () => {
    localStorage.setItem(CONSENT_KEY, consentFingerprint());
    server.token = { code: 503, body: { error: 'disabled' } };
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    fireEvent.click(theSwitch());
    await waitFor(() => expect(stateText()).toBe(COPY.refused['server-off']));
    expect(plugin.start).not.toHaveBeenCalled();
  });
});

describe('what the service says', () => {
  const runningInAGroup = async () => {
    localStorage.setItem(CONSENT_KEY, consentFingerprint());
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
    await openSettings();
    await waitFor(() => section());
  };

  it('Paused, and back to Sharing', async () => {
    await runningInAGroup();
    act(() => plugin.listeners.forEach((fn) => fn({ state: 'paused' })));
    await waitFor(() => expect(stateText()).toBe('Paused'));
    act(() => plugin.listeners.forEach((fn) => fn({ state: 'running' })));
    await waitFor(() => expect(stateText()).toMatch(/^Sharing with /));
  });

  it('stopped by itself: says why, in plain words', async () => {
    await runningInAGroup();
    act(() => plugin.listeners.forEach((fn) => fn({ state: 'stopped', reason: 'disabled' })));
    await waitFor(() => expect(stateText()).toBe(COPY.stopped.disabled));
    act(() => plugin.listeners.forEach((fn) => fn({ state: 'stopped', reason: 'forbidden' })));
    await waitFor(() => expect(stateText()).toBe(COPY.stopped.forbidden));
  });

  it('the app\'s own stop is not reported as a stop', async () => {
    await runningInAGroup();
    act(() => plugin.listeners.forEach((fn) => fn({ state: 'stopped', reason: 'app-stop' })));
    await flush();
    expect(stateText()).not.toMatch(/stopped/i);
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('Stop on the notification turns the switch off, and the line says Not sharing', async () => {
    await runningInAGroup();
    act(() => plugin.listeners.forEach((fn) => fn({ state: 'stopped', reason: 'user-stop' })));
    await waitFor(() => expect(theSwitch().getAttribute('aria-checked')).toBe('false'));
    expect(stateText()).toBe('Not sharing');
    expect(localStorage.getItem(SWITCH_KEY)).toBe('0');
  });
});

describe('what ends it', () => {
  it('turning the switch off', async () => {
    localStorage.setItem(CONSENT_KEY, consentFingerprint());
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalled());
    await openSettings();
    await waitFor(() => section());
    plugin.stop.mockClear();
    fireEvent.click(theSwitch());
    await waitFor(() => expect(plugin.stop).toHaveBeenCalledWith({ reason: 'app-stop' }));
    await waitFor(() => expect(stateText()).toBe('Not sharing'));
  });

  it('leaving the Group', async () => {
    localStorage.setItem(CONSENT_KEY, consentFingerprint());
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalled());
    plugin.stop.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByTestId('leave-group'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Leave the group?' })).getByRole('button', { name: 'Leave group' }));
    await flush();
    expect(fakeSocket.emit.mock.calls.some(([e]) => e === 'leave-squad')).toBe(true);
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'app-stop' });
  });

  it('signing out', async () => {
    localStorage.setItem(CONSENT_KEY, consentFingerprint());
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalled());
    plugin.stop.mockClear();
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await flush();
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'app-stop' });
  });

  it('the server switching it off: the switch goes, the service is stopped, nothing loops', async () => {
    localStorage.setItem(CONSENT_KEY, consentFingerprint());
    localStorage.setItem(SWITCH_KEY, '1');
    await renderApp();
    await intoGroup();
    await waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
    await openSettings();
    await waitFor(() => section());
    plugin.stop.mockClear();
    server.status = { code: 200, body: { available: false } };
    // Settings opens and closes: the question is asked again.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await flush();
    await openSettings();
    await waitFor(() => expect(screen.queryByTestId('background-sharing')).toBeNull());
    expect(plugin.stop).toHaveBeenCalledWith({ reason: 'app-stop' });
    await flush();
    expect(plugin.start).toHaveBeenCalledTimes(1);
    expect(tokenRequests()).toHaveLength(1);
  });
});

describe('opening the app after the Group ended', () => {
  const MESSAGE = 'Your Group ended (the server restarted). Rejoin with the code.';

  it('says so in the lobby when the last sharing stopped because the Group was gone, once', async () => {
    plugin.lastState = { running: false, state: 'stopped', reason: 'group-gone' };
    await renderApp();
    await waitFor(() => expect(screen.getByText(MESSAGE)).toBeTruthy());
    expect(plugin.acknowledgeStop).toHaveBeenCalledTimes(1);
  });

  it('says nothing for any other ending, but forgets it', async () => {
    for (const reason of ['forbidden', 'token-expired', 'disabled']) {
      plugin.lastState = { running: false, state: 'stopped', reason };
      plugin.acknowledgeStop.mockClear();
      await renderApp();
      await waitFor(() => expect(plugin.acknowledgeStop).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(MESSAGE), reason).toBeNull();
      cleanup();
    }
  });

  it('says nothing while sharing is still running', async () => {
    plugin.lastState = { running: true, state: 'running', reason: 'group-gone' };
    await renderApp();
    await flush();
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(plugin.acknowledgeStop).not.toHaveBeenCalled();
  });

  it('says nothing in an app without the service', async () => {
    shell.hasPlugin = false;
    plugin.lastState = { running: false, state: 'stopped', reason: 'group-gone' };
    await renderApp();
    await flush();
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(plugin.getState).not.toHaveBeenCalled();
  });
});

describe('an SOS heard while the app was closed', () => {
  const SOS_CAPS = { sosAlerts: true, sosAlertsOn: true, sosAudible: true, sosFullScreen: true };
  const tap = (over = {}) => act(() => plugin.listeners.slice().forEach((fn) => fn({ id: 'sos-9', senderId: 'uA', senderName: 'Asha', lat: 12.8231, lng: 80.0442, ageMs: 4000, timestamp: 1, ...over })));
  const sosSwitch = () => within(section()).getByRole('switch', { name: new RegExp(COPY.sos.label) });

  it('opens straight to the SOS overlay when the notification is tapped, even before joining a Group', async () => {
    plugin.caps = { ...plugin.caps, ...SOS_CAPS };
    await renderApp();
    await flush();
    tap();
    await flush();
    expect(screen.getByText(SOS_RECEIVED.needsHelp('Asha'))).toBeTruthy();
    expect(plugin.sosShown).toHaveBeenCalledWith({ id: 'sos-9' });
  });

  it('acknowledging it tells the server through the plugin, and clears it', async () => {
    plugin.caps = { ...plugin.caps, ...SOS_CAPS };
    await renderApp();
    await flush();
    tap();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: SOS_RECEIVED.acknowledge }));
    expect(plugin.acknowledgeSos).toHaveBeenCalledWith({ id: 'sos-9', more: false });
    expect(fakeSocket.emit).toHaveBeenCalledWith('sos-ack', { id: 'sos-9' });
    expect(screen.queryByText(SOS_RECEIVED.needsHelp('Asha'))).toBeNull();
  });

  it('is one overlay when the same beacon then arrives over the socket', async () => {
    plugin.caps = { ...plugin.caps, ...SOS_CAPS };
    await renderApp();
    await intoGroup();
    tap();
    act(() => fakeSocket.receive('sos-received', { id: 'sos-9', senderId: 'sock-a', senderName: 'Asha', lat: 12.8231, lng: 80.0442, ageMs: 9000, timestamp: 1 }));
    await flush();
    expect(screen.getAllByText(SOS_RECEIVED.needsHelp('Asha'))).toHaveLength(1);
    expect(screen.queryByText(SOS_RECEIVED.ofTotal(1, 2))).toBeNull();
  });

  it('the Settings switch is there, on, and locked until Keep sharing is turned on', async () => {
    plugin.caps = { ...plugin.caps, ...SOS_CAPS };
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    expect(within(section()).getByText(COPY.sos.description)).toBeTruthy();
    expect(within(section()).getByText(COPY.sos.needsSharing)).toBeTruthy();
    expect(sosSwitch().getAttribute('aria-checked')).toBe('false'); // sharing is off, so these are too
    fireEvent.click(sosSwitch());
    expect(plugin.setSosAlerts).not.toHaveBeenCalled();
  });

  it('turning it off and on again reaches the plugin once sharing is on', async () => {
    plugin.caps = { ...plugin.caps, ...SOS_CAPS };
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    fireEvent.click(within(section()).getByRole('switch', { name: new RegExp(COPY.switchLabel) }));
    await waitFor(() => screen.getByTestId('background-sharing-consent'));
    fireEvent.click(screen.getByRole('button', { name: COPY.consent.accept }));
    await waitFor(() => expect(sosSwitch().getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(sosSwitch());
    expect(plugin.setSosAlerts).toHaveBeenLastCalledWith({ enabled: false });
    expect(sosSwitch().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sosSwitch());
    expect(plugin.setSosAlerts).toHaveBeenLastCalledWith({ enabled: true });
  });

  it('a shell that predates it shows the old Settings, one switch', async () => {
    await renderApp();
    await intoGroup();
    await openSettings();
    await waitFor(() => section());
    expect(within(section()).getAllByRole('switch')).toHaveLength(1);
    expect(screen.queryByTestId('sos-alerts')).toBeNull();
  });
});
