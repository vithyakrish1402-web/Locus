// @vitest-environment jsdom
//
// The map screen's top bar and sharing chip (redesign Map batch), through the real App.jsx:
// the bar names the map that is showing (the design build has no buttons on it; sign-out and
// the owner's Admin tools are in Settings > Account); the chip says your own setting in the
// owner's words, and never "invisible".
import { readFileSync } from 'node:fs';
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
// `user` is who signs in; a test may set it before rendering (reset after each test).
const auth = vi.hoisted(() => ({ signOut: null, user: null }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => {
  auth.signOut = vi.fn(() => Promise.resolve());
  return {
    onAuthStateChanged: (_auth, callback) => {
      callback(auth.user ?? { uid: 'u-self', displayName: 'Alpha', photoURL: null });
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
// The owner's email, read from App.jsx rather than written out again here.
const ADMIN_EMAIL = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8').match(/const ADMIN_EMAIL = "([^"]+)"/)[1];

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
  auth.user = null;
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

  it('has a search icon beside the name, and nothing else to press', () => {
    onTheMap();
    expect(bar().getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([TOP_BAR.search]);
    expect(screen.queryByTestId('top-bar-search')).toBeNull();
  });

  it('the search icon opens a box beside LOCUS; typing brings up the Buildings list, filtered, at full height; closing clears it', async () => {
    onTheMap();
    fireEvent.click(bar().getByRole('button', { name: TOP_BAR.search }));
    const box = screen.getByTestId('top-bar-search');
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'zzqx' } });
    expect(screen.getByTestId('buildings-no-match').textContent).toBe('No building called "zzqx"');
    fireEvent.change(box, { target: { value: '  tech park  ' } });
    await act(async () => {});
    expect(screen.queryByTestId('buildings-no-match')).toBeNull();
    const names = screen.getAllByTestId('building-row').map((r) => r.textContent).join(' ');
    expect(names).toMatch(/TECH PARK/);
    fireEvent.click(bar().getByRole('button', { name: TOP_BAR.clearSearch }));
    // The box folds back into the icon, then is gone.
    await waitFor(() => expect(screen.queryByTestId('top-bar-search')).toBeNull());
    expect(bar().getByRole('button', { name: TOP_BAR.search })).toBeTruthy();
    expect(screen.queryByTestId('buildings-no-match')).toBeNull();
    await act(async () => {});
    expect(screen.getAllByTestId('building-row').length).toBeGreaterThan(5);
  });

  it('while the search box has the keyboard up the group panel steps its header aside, and brings it back on blur or close', async () => {
    // On a phone (the keyboard only matters there).
    const realMatchMedia = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    onTheMap();
    fireEvent.click(bar().getByRole('button', { name: TOP_BAR.search }));
    const box = screen.getByTestId('top-bar-search');
    const hidden = () => /(^|\s)hidden(\s|$)/.test(screen.getByTestId('group-panel-header').className);
    // The box takes focus as it opens (autoFocus), so the keyboard is up.
    expect(hidden()).toBe(true);
    fireEvent.blur(box);
    expect(hidden()).toBe(false);
    fireEvent.focus(box);
    fireEvent.click(bar().getByRole('button', { name: TOP_BAR.clearSearch }));
    expect(hidden()).toBe(false);
    window.matchMedia = realMatchMedia;
  });

  it('signs out from Settings, under Account (the bar has no sign-out button)', async () => {
    onTheMap();
    expect(bar().queryByRole('button', { name: SETTINGS.signOut })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.open }));
    const settings = within(screen.getByTestId('settings'));
    expect(settings.getByText(SETTINGS.account)).toBeTruthy();
    fakeSocket.emit.mockClear();
    fireEvent.click(settings.getByRole('button', { name: SETTINGS.signOut }));
    expect(auth.signOut).toHaveBeenCalled();
    expect(fakeSocket.emit.mock.calls.some(([e]) => e === 'leave-squad')).toBe(true);
    // Settings is closed too, so it isn't still open over the map on the next Group.
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER' }));
    await waitFor(() => expect(screen.queryByTestId('settings')).toBeNull());
  });

  it('Settings opens from the gear in the map controls, the one place it lives on the map', () => {
    onTheMap();
    expect(screen.getAllByRole('button', { name: SETTINGS.open })).toHaveLength(1);
    expect(bar().queryByRole('button', { name: SETTINGS.open })).toBeNull();
  });

  it('only the admin sees Admin tools in Settings', () => {
    onTheMap();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.open }));
    expect(within(screen.getByTestId('settings')).queryByRole('button', { name: new RegExp(SETTINGS.adminTools) })).toBeNull();
  });

  it('the admin opens Admin tools from Settings, which closes Settings', async () => {
    auth.user = { uid: 'u-self', displayName: 'Alpha', photoURL: null, email: ADMIN_EMAIL };
    onTheMap();
    expect(screen.queryByTestId('admin-tools')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS.open }));
    fireEvent.click(within(screen.getByTestId('settings')).getByRole('button', { name: new RegExp(SETTINGS.adminTools) }));
    expect(screen.getByRole('dialog', { name: 'ADMIN_OVERRIDE' })).toBeTruthy();
    // Settings leaves with its exit animation.
    await waitFor(() => expect(screen.queryByTestId('settings')).toBeNull());
  });
});

describe('the sharing chip', () => {
  it.each([
    ['ACTIVE', null],
    ['FROZEN', 'FROZEN'],
    ['GHOST', 'GHOST'],
  ])('%s (with a fix)', (mode, button) => {
    navigator.geolocation.getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } }));
    onTheMap();
    if (button) {
      fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
      fireEvent.click(screen.getByRole('radio', { name: { FROZEN: 'Paused', GHOST: 'Hidden' }[button] }));
    }
    expect(chip().dataset.mode).toBe(mode);
    expect(chip().textContent).toBe(SHARING_CHIP[mode]);
  });

  it('live with no fix yet says "Waiting for your location", then "Sharing live" once the fix arrives', () => {
    let answer;
    navigator.geolocation.getCurrentPosition = vi.fn((ok) => { answer = ok; });
    onTheMap();
    expect(chip().dataset.mode).toBe('waiting');
    expect(chip().textContent).toBe('Waiting for your location');
    expect(chip().textContent).not.toMatch(/live/i);
    act(() => answer({ coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } }));
    expect(chip().dataset.mode).toBe('ACTIVE');
    expect(chip().textContent).toBe(SHARING_CHIP.ACTIVE);
  });

  it('Hidden with no fix yet keeps its own words', () => {
    onTheMap();
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hidden' }));
    expect(chip().dataset.mode).toBe('GHOST');
    expect(chip().textContent).toBe(SHARING_CHIP.GHOST);
  });

  it('Paused before any fix: "no spot shared yet", and still so once a fix arrives (it isn\'t shared)', () => {
    let answer;
    navigator.geolocation.getCurrentPosition = vi.fn((ok) => { answer = ok; });
    onTheMap();
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Paused' }));
    expect(chip().dataset.mode).toBe('pausedNoSpot');
    expect(chip().textContent).toBe('Sharing paused · no spot shared yet');
    act(() => answer({ coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } }));
    expect(chip().textContent).toBe('Sharing paused · no spot shared yet');
  });

  it('Paused after a fix: the group sees that spot, and Live again drops it', () => {
    navigator.geolocation.getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: 12.8235, longitude: 80.0446, speed: 0 } }));
    onTheMap();
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Paused' }));
    expect(chip().textContent).toBe(SHARING_CHIP.FROZEN);
    fireEvent.click(screen.getByRole('radio', { name: 'Live' }));
    expect(chip().textContent).toBe(SHARING_CHIP.ACTIVE);
  });

  it('uses the owner\'s words, never "invisible" or "nobody can see you"', () => {
    expect(SHARING_CHIP).toEqual({
      ACTIVE: 'Sharing live with your group',
      FROZEN: 'Sharing paused · your group sees your last spot',
      GHOST: "Hidden from other members' maps",
      waiting: 'Waiting for your location',
      pausedNoSpot: 'Sharing paused · no spot shared yet',
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

describe('the group panel list on a phone', () => {
  // Tailwind's spacing scale: bottom-20 / h-20 are 5 rem, bottom-16 is 4 rem.
  const rem = (cls, prefix) => {
    const m = cls.match(new RegExp(`(?:^| )${prefix}-(\\d+)(?= |$)`));
    return m ? Number(m[1]) / 4 : null;
  };

  it('scrolls its last rows clear of the Emergency and meeting point buttons, gesture bar included', () => {
    window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    onTheMap();
    fireEvent.click(screen.getByRole('radio', { name: 'Members' }));
    const list = screen.getByTestId('group-panel-list');
    const panel = list.parentElement;
    const sos = screen.getByRole('button', { name: /SOS beacon/ });
    const flag = screen.getByTestId('meeting-point-button');

    // Both buttons stand on the gesture bar's inset (set inline, which jsdom drops, so read
    // from their source); the list's bottom room must count it too.
    for (const src of ['SosTrigger.jsx', 'map/MapControls.jsx']) {
      expect(readFileSync(new URL('../src/components/' + src, import.meta.url), 'utf8')).toContain("marginBottom: 'env(safe-area-inset-bottom)'");
    }
    const pad = list.className.match(/(?:^| )pb-\[calc\((\d+)rem\+env\(safe-area-inset-bottom\)\)\]/);
    expect(pad).toBeTruthy();

    // Where the last row can end, above the screen's bottom edge (inset aside), against the
    // top of the taller button: 2 rem between them.
    const lastRowEnds = rem(panel.className, 'bottom') + Number(pad[1]);
    const buttonsTop = Math.max(...[sos, flag].map((b) => rem(b.className, 'bottom') + rem(b.className, 'h')));
    expect(lastRowEnds - buttonsTop).toBeGreaterThanOrEqual(2);
    // A wider screen keeps its own small padding (no floating buttons over the list there).
    expect(list.className).toMatch(/(^| )md:pb-4( |$)/);
    delete window.matchMedia;
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
