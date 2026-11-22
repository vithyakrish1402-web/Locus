// @vitest-environment jsdom
//
// The UI audit fix pass (2026-10-25), through the real App.jsx on a phone-sized screen:
// A1  a closed Buildings or Group page is not drawn at all (it was only invisible, and parts of
//     it were left floating over the map),
// A5  a notice over Settings stands under Settings' own header, never over Back,
// A7  Emergency alerts is a fixed "Always on", not a switch,
// A9  the group code is one chip that copies it; the empty card has no second Copy button,
// A10 the map's top bar (LOCUS and its search) goes while Buildings or Group is open.
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
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({ default: () => <div data-testid="leaflet-stub" /> }));
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
const { SETTINGS } = await import('../src/copy/settings.js');
const { GROUP_HEADER } = await import('../src/copy/group.js');
const { TOAST_TOP_OFFSET_PX } = await import('../src/components/CommsFeed.jsx');
const { notify, __resetNotifications } = await import('../src/utils/notify.js');
const { setSettingsOpen } = await import('../src/utils/settingsOpen.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
let code;

// jsdom has no layout: say whether the screen is a phone's (the app asks matchMedia).
const screenIs = (phone) => {
  window.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
};
const tabBar = () => within(screen.getByRole('navigation', { name: 'Main' }));
const page = () => screen.getByTestId('section-page');
const classes = (el) => String(el.className).split(/\s+/);

const onTheMap = async () => {
  localStorage.setItem('locus.cameraAllowed', '1');
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
  await act(async () => {});
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
  act(() => setSettingsOpen(false));
  __resetNotifications?.();
  vi.restoreAllMocks();
  delete navigator.geolocation;
});

describe('A1: a closed page is not drawn at all', () => {
  it('Group, then Map from the tab bar: display none, not merely invisible', async () => {
    await onTheMap();
    expect(classes(page())).toContain('hidden');
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    expect(classes(page())).toContain('flex');
    expect(classes(page())).not.toContain('hidden');
    fireEvent.click(tabBar().getByRole('button', { name: 'Map' }));
    expect(classes(page())).toContain('hidden');
    expect(classes(page())).not.toContain('flex');
    expect(classes(page())).not.toContain('invisible');
  });

  it('Buildings, then its own close button', async () => {
    await onTheMap();
    fireEvent.click(tabBar().getByRole('button', { name: 'Buildings' }));
    expect(classes(page())).not.toContain('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(classes(page())).toContain('hidden');
  });
});

describe('A10: one search box at a time', () => {
  it('the top bar goes while Buildings or Group is open, and comes back after', async () => {
    await onTheMap();
    expect(screen.getByTestId('top-bar')).toBeTruthy();
    fireEvent.click(tabBar().getByRole('button', { name: 'Buildings' }));
    expect(screen.queryByTestId('top-bar')).toBeNull();
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    expect(screen.queryByTestId('top-bar')).toBeNull();
    fireEvent.click(tabBar().getByRole('button', { name: 'Map' }));
    expect(screen.getByTestId('top-bar')).toBeTruthy();
  });

  it('stays while someone is typing in it (typing there is what opens Buildings)', async () => {
    await onTheMap();
    fireEvent.click(screen.getByTestId('top-bar-search-open'));
    const box = screen.getByTestId('top-bar-search');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'tech' } });
    expect(page().dataset.section).toBe('buildings');
    expect(classes(page())).not.toContain('hidden');
    expect(screen.getByTestId('top-bar-search')).toBe(box);
    fireEvent.blur(box);
    expect(screen.queryByTestId('top-bar')).toBeNull();
  });
});

describe('the Group page says "Your group" once', () => {
  it('in its title bar only, not again in the header under it', async () => {
    await onTheMap();
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    expect(within(page()).getAllByText(GROUP_HEADER.title)).toHaveLength(1);
    expect(within(page()).getByRole('heading', { name: GROUP_HEADER.title })).toBeTruthy();
    expect(within(screen.getByTestId('group-header')).queryByText(GROUP_HEADER.title)).toBeNull();
  });
});

describe('A9: the group code is one chip', () => {
  it('shows the code and copies it; the empty card has no Copy button of its own', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await onTheMap();
    fireEvent.click(tabBar().getByRole('button', { name: 'Group' }));
    act(() => fakeSocket.receive('users-update', {}));
    const header = within(screen.getByTestId('group-header'));
    const chip = header.getByRole('button', { name: GROUP_HEADER.copy });
    expect(within(chip).getByTestId('group-code').textContent).toBe(GROUP_HEADER.code(code));
    await act(async () => { fireEvent.click(chip); });
    expect(writeText).toHaveBeenCalledWith(code);
    expect(header.getByRole('button', { name: GROUP_HEADER.copied })).toBeTruthy();
    const empty = screen.getByTestId('members-empty');
    expect(within(empty).queryByRole('button')).toBeNull();
    delete navigator.clipboard;
  });
});

describe('Settings', () => {
  const openSettings = async () => {
    await onTheMap();
    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    await screen.findByTestId('settings');
  };

  it('A7: Emergency alerts reads "Always on" and is not a switch', async () => {
    await openSettings();
    expect(screen.queryByRole('switch', { name: new RegExp(`^${SETTINGS.emergencyAlerts}`) })).toBeNull();
    const row = screen.getByTestId('emergency-alerts');
    expect(row.textContent).toContain(SETTINGS.emergencyAlerts);
    expect(row.textContent).toContain(SETTINGS.alwaysOn);
    expect(row.textContent).toContain(SETTINGS.emergencyAlertsHelp);
  });

  it('A5: a notice stands under the Settings header, not over Back', async () => {
    await openSettings();
    const header = document.querySelector('[data-settings-header]');
    expect(within(header).getByRole('button', { name: SETTINGS.back })).toBeTruthy();
    // Where the header ends on this pretend phone: 40 px of status bar, then the Back row.
    header.getBoundingClientRect = () => ({ top: 52, bottom: 108, left: 0, right: 412, width: 412, height: 56 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    act(() => { notify.success('Emergency alert sent to your group'); });
    expect(screen.getByTestId('comms-feed').style.top).toBe(`${108 + TOAST_TOP_OFFSET_PX}px`);
  });
});
