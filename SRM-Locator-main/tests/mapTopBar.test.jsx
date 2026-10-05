// @vitest-environment jsdom
//
// The map screen's top bar and sharing chip (redesign Map batch), through the real App.jsx:
// the bar names the map that is showing and signs out; the chip says your own setting in the
// owner's words, and never "invisible".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within } from '@testing-library/react';

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
const auth = vi.hoisted(() => ({ signOut: null }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => {
  auth.signOut = vi.fn(() => Promise.resolve());
  return {
    onAuthStateChanged: (_auth, callback) => {
      callback({ uid: 'u-self', displayName: 'Alpha', photoURL: null });
      return () => {};
    },
    signInWithPopup: vi.fn(),
    signOut: auth.signOut,
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    updateProfile: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
  };
});
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
const { SHARING_CHIP, TOP_BAR } = await import('../src/copy/map.js');
const { SETTINGS } = await import('../src/copy/settings.js');

const onTheMap = () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
};
const bar = () => within(screen.getByTestId('top-bar'));
const chip = () => screen.getByTestId('sharing-chip');

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

describe('the top bar', () => {
  it('names LOCUS and the map showing, without the old tactical words', () => {
    onTheMap();
    expect(bar().getByText(TOP_BAR.name)).toBeTruthy();
    expect(bar().getByText(TOP_BAR.mapView)).toBeTruthy();
    expect(screen.getByTestId('top-bar').textContent).not.toMatch(/TACTICAL|ORBITAL|GRID/);
  });

  it('says Satellite view once the map is satellite', () => {
    onTheMap();
    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: SETTINGS.mapView })).getByRole('radio', { name: SETTINGS.mapViewOptions.satellite }));
    expect(bar().getByText(TOP_BAR.satelliteView)).toBeTruthy();
  });

  it('signs out', () => {
    onTheMap();
    fireEvent.click(bar().getByRole('button', { name: TOP_BAR.signOut }));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('keeps the gear in the map controls as Settings on a phone (no new top-bar button there)', () => {
    onTheMap();
    const inBar = bar().getByRole('button', { name: SETTINGS.open });
    expect(inBar.parentElement.className).toMatch(/(^| )hidden md:flex/);
    expect(screen.getAllByRole('button', { name: SETTINGS.open }).length).toBe(2);
  });
});

describe('the sharing chip', () => {
  it.each([
    ['ACTIVE', null],
    ['FROZEN', 'FROZEN'],
    ['GHOST', 'GHOST'],
  ])('%s', (mode, button) => {
    onTheMap();
    if (button) {
      fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' })[0]);
      fireEvent.click(screen.getByRole('button', { name: button }));
    }
    expect(chip().dataset.mode).toBe(mode);
    expect(chip().textContent).toBe(SHARING_CHIP[mode]);
  });

  it('uses the owner\'s words, never "invisible" or "nobody can see you"', () => {
    expect(SHARING_CHIP).toEqual({
      ACTIVE: 'Sharing live with your group',
      FROZEN: 'Sharing paused · your group sees your last spot',
      GHOST: "Hidden from other members' maps",
    });
    Object.values(SHARING_CHIP).forEach((w) => expect(w).not.toMatch(/invisible|nobody/i));
  });

  it('has no button on it (Pause on the chip is not in this phase)', () => {
    onTheMap();
    expect(within(chip()).queryByRole('button')).toBeNull();
  });
});

describe('the map controls', () => {
  const controls = () => within(screen.getByTestId('map-controls'));

  it('keep every control: satellite, the whole campus and Settings (and locate once there is a fix)', () => {
    onTheMap();
    expect(controls().getByRole('button', { name: 'Satellite view' })).toBeTruthy();
    expect(controls().getByRole('button', { name: 'Show the whole campus' })).toBeTruthy();
    expect(controls().getByRole('button', { name: SETTINGS.open })).toBeTruthy();
    expect(controls().queryByRole('button', { name: 'Show where you are' })).toBeNull();
  });

  it('satellite is a toggle that says when it is on', () => {
    onTheMap();
    const satellite = controls().getByRole('button', { name: 'Satellite view' });
    expect(satellite.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(satellite);
    expect(satellite.getAttribute('aria-pressed')).toBe('true');
    expect(bar().getByText(TOP_BAR.satelliteView)).toBeTruthy();
  });

  it('the gear opens Settings', () => {
    onTheMap();
    fireEvent.click(controls().getByRole('button', { name: SETTINGS.open }));
    expect(screen.getByTestId('settings')).toBeTruthy();
  });

  it('the meeting point button turns into Cancel while choosing, never red', () => {
    onTheMap();
    const button = screen.getByTestId('meeting-point-button');
    expect(button.getAttribute('aria-label')).toBe('Place a meeting point');
    fireEvent.click(button);
    expect(button.getAttribute('aria-label')).toBe('Cancel placing a meeting point');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.outerHTML).not.toMatch(/red-|danger|yellow-/);
  });

  it('no control is red', () => {
    onTheMap();
    expect(screen.getByTestId('map-controls').outerHTML).not.toMatch(/red-|danger/);
  });
});

describe('the locate control', () => {
  it('appears once there is a fix', async () => {
    navigator.geolocation.getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } }));
    onTheMap();
    expect(await within(screen.getByTestId('map-controls')).findByRole('button', { name: 'Show where you are' })).toBeTruthy();
  });
});

describe('the stack under the top bar', () => {
  it('choosing a meeting point (on a phone): the banner takes the chip\'s place, and Cancel ends it', () => {
    window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    onTheMap();
    fireEvent.click(screen.getByTestId('meeting-point-button'));
    const banner = screen.getByTestId('meeting-point-banner');
    expect(banner.textContent).toContain('Tap the map to place a meeting point');
    expect(screen.queryByTestId('sharing-chip')).toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('meeting-point-button').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('sharing-chip')).toBeTruthy();
    delete window.matchMedia;
  });

  it('"Finding your location…" until the first fix arrives', async () => {
    let answer;
    navigator.geolocation.getCurrentPosition = vi.fn((ok) => { answer = ok; });
    onTheMap();
    expect(screen.getByTestId('finding-location').textContent).toBe('Finding your location…');
    act(() => answer({ coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } }));
    expect(screen.queryByTestId('finding-location')).toBeNull();
  });

  it('no "Finding your location…" while the location problem shows instead', () => {
    navigator.geolocation.getCurrentPosition = vi.fn((_ok, fail) => fail({ code: 1, message: 'denied' }));
    onTheMap();
    expect(screen.getByTestId('location-problem')).toBeTruthy();
    expect(screen.queryByTestId('finding-location')).toBeNull();
  });
});
