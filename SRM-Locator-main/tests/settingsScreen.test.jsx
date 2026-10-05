// @vitest-environment jsdom
//
// Settings as a full screen (redesign P9), through the real App.jsx: opened from the gear,
// closed with Back, the theme saved and shown at once, Alert sounds that really silence the
// ping and lost-connection sounds (and never the Emergency alarm), About with the version,
// Check for updates and How LOCUS works, and "More" keeping every old setting.
//
// Only the socket transport, Firebase, native plugins, maps and the update hooks are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

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
// What the APK updater reports; a test changes it before rendering.
const updater = vi.hoisted(() => ({ supported: false, status: 'idle', installedVersion: null, check: null }));

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
      supported: updater.supported,
      status: updater.status,
      manifest: null,
      installedVersion: updater.installedVersion,
      progress: { percent: -1, loaded: 0, total: 0 },
      error: null,
      mandatory: false,
      dismissed: false,
      check: updater.check,
      startDownload: vi.fn(),
      openInstallSettings: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

const { default: App } = await import('../src/App.jsx');
const { SETTINGS } = await import('../src/copy/settings.js');
const { __resetTheme } = await import('../src/theme/theme.js');

// Counts the sounds made: each AudioContext is one sound starting.
let sounds = 0;
class FakeAudioContext {
  constructor() {
    sounds += 1;
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  createOscillator() {
    return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

const onTheMap = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
};
const openSettings = () => {
  onTheMap();
  fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
  return screen.getByTestId('settings');
};
const radio = (group, name) => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name });
const alertSounds = () => screen.getByRole('switch', { name: new RegExp(`^${SETTINGS.alertSounds}`) });

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  sounds = 0;
  window.AudioContext = FakeAudioContext;
  Object.assign(updater, { supported: false, status: 'idle', installedVersion: null, check: vi.fn() });
  try { localStorage.clear(); } catch { /* no storage here */ }
  __resetTheme();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete navigator.geolocation;
  delete window.AudioContext;
  delete document.documentElement.dataset.theme;
});

describe('Settings', () => {
  it('opens from the gear as a full screen, and Back closes it', async () => {
    const settings = openSettings();
    expect(within(settings).getByRole('heading', { name: SETTINGS.title })).toBeTruthy();
    expect(settings.textContent).not.toMatch(/SYS_CONFIG|SONAR|TELEMETRY_POLLING|AR_RENDER_MODE/);
    fireEvent.click(within(settings).getByRole('button', { name: SETTINGS.back }));
    await waitFor(() => expect(screen.queryByTestId('settings')).toBeNull());
  });

  it('has the design order: Appearance, refresh rate, AR Scan quality, Notifications, About, then More', () => {
    const settings = openSettings();
    const order = [SETTINGS.appearance, SETTINGS.refresh, SETTINGS.arQuality, SETTINGS.notifications, SETTINGS.about, SETTINGS.more]
      .map((label) => within(settings).getAllByText(label)[0]);
    order.slice(1).forEach((el, i) => {
      expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('shows the theme choice at once and remembers it', () => {
    openSettings();
    expect(radio(SETTINGS.theme, SETTINGS.themeOptions.system).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(SETTINGS.themeHelp.system)).toBeTruthy();
    fireEvent.click(radio(SETTINGS.theme, SETTINGS.themeOptions.dark));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('locus.theme')).toBe('dark');
    expect(screen.getByText(SETTINGS.themeHelp.dark)).toBeTruthy();
  });

  it('offers the three refresh rates the app has always had, Standard first chosen', () => {
    openSettings();
    const options = within(screen.getByRole('radiogroup', { name: SETTINGS.refresh })).getAllByRole('radio');
    expect(options.map((o) => o.textContent)).toEqual([
      'Battery saverEvery 15 seconds', 'StandardEvery 5 seconds', 'FastEvery second · uses more battery',
    ]);
    expect(options[1].getAttribute('aria-checked')).toBe('true');
  });

  it('a refresh rate chosen is the one in use (Fast: every second)', () => {
    openSettings();
    const log = vi.spyOn(console, 'log');
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${SETTINGS.refreshOptions.max.label}`) }));
    expect(screen.getByRole('radio', { name: new RegExp(`^${SETTINGS.refreshOptions.max.label}`) }).getAttribute('aria-checked')).toBe('true');
    expect(log).toHaveBeenCalledWith('[SYS_CONFIG] Telemetry polling initialized at 1000ms');
  });

  it('keeps every old setting under More: map view, the map status line, AR Scan parts and Send LOCUS', () => {
    const settings = openSettings();
    expect(screen.getByRole('radiogroup', { name: SETTINGS.mapView })).toBeTruthy();
    expect(screen.getByTestId('map-engine-status')).toBeTruthy();
    for (const part of Object.values(SETTINGS.arPartNames)) expect(screen.getByRole('radiogroup', { name: part })).toBeTruthy();
    expect(within(settings).getByTestId('send-app')).toBeTruthy();
  });

  it('Map view switches the map to satellite and back', () => {
    openSettings();
    fireEvent.click(radio(SETTINGS.mapView, SETTINGS.mapViewOptions.satellite));
    expect(screen.getByText('ORBITAL RECON')).toBeTruthy();
    fireEvent.click(radio(SETTINGS.mapView, SETTINGS.mapViewOptions.map));
    expect(screen.getByText('TACTICAL GRID')).toBeTruthy();
  });
});

describe('Alert sounds', () => {
  it('is on by default: a ping and a lost connection make their sound', () => {
    openSettings();
    expect(alertSounds().getAttribute('aria-checked')).toBe('true');
    act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));
    act(() => fakeSocket.receive('member-signal-lost', { targetId: 's-b', uid: 'u-b', name: 'Bravo', lastKnownLocation: { lat: 12.82, lng: 80.04 }, timeDelta: 0 }));
    expect(sounds).toBe(2);
  });

  it('off, silences the ping and lost-connection sounds', () => {
    openSettings();
    fireEvent.click(alertSounds());
    expect(alertSounds().getAttribute('aria-checked')).toBe('false');
    act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));
    act(() => fakeSocket.receive('member-signal-lost', { targetId: 's-b', uid: 'u-b', name: 'Bravo', lastKnownLocation: { lat: 12.82, lng: 80.04 }, timeDelta: 0 }));
    expect(sounds).toBe(0);
    // The notices still come.
    expect(screen.getByText('Bravo is pinging you')).toBeTruthy();
  });

  it('off, never silences the Emergency alarm', () => {
    openSettings();
    fireEvent.click(alertSounds());
    act(() => fakeSocket.receive('sos-received', { id: 's1', senderId: 'x', senderName: 'Bravo', lat: 12.82, lng: 80.04, timestamp: 1, ageMs: 0 }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(sounds).toBeGreaterThan(0);
  });

  it('shows Emergency alerts as always on, and it cannot be turned off', () => {
    openSettings();
    const emergency = screen.getByRole('switch', { name: new RegExp(`^${SETTINGS.emergencyAlerts}`) });
    expect(emergency.getAttribute('aria-checked')).toBe('true');
    expect(emergency.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(emergency);
    expect(emergency.getAttribute('aria-checked')).toBe('true');
  });
});

describe('About', () => {
  it('shows the installed version and checks for updates on request', () => {
    Object.assign(updater, { supported: true, installedVersion: '1.1.0', status: 'up-to-date' });
    openSettings();
    expect(screen.getByTestId('settings-version').textContent).toBe('1.1.0');
    expect(screen.getByText(SETTINGS.updateStatus['up-to-date'])).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.checkForUpdates }));
    expect(updater.check).toHaveBeenCalledWith({ manual: true });
  });

  it('off the phone, says updates come to the installed app only, and cannot check', () => {
    openSettings();
    expect(screen.getByTestId('settings-version').textContent).toBe(SETTINGS.versionUnknown);
    expect(screen.getByText(SETTINGS.updatesWebOnly)).toBeTruthy();
    expect(screen.getByRole('button', { name: SETTINGS.checkForUpdates }).disabled).toBe(true);
  });

  it('How LOCUS works opens the guide over Settings', () => {
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SETTINGS.howItWorks) }));
    expect(screen.getByTestId('guide')).toBeTruthy();
  });
});
