// @vitest-environment jsdom
//
// WiFi Arc Stage 7, through the real App.jsx on both map engines: the indoor "you are
// here" marker and halo, the floor picker, the return chip, and - behind its own flag -
// squadmates' floors on the map and the roster, plus what update-location carries.
//
// The flags are forced on here (they ship off). Only the fusion controller is faked - its
// scanning is Stage 6's and tested in wifiFusion.test.js - along with the socket
// transport, Firebase, native plugins, the Google map's canvas and the update hooks.
// react-leaflet renders for real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { MotionGlobalConfig } from 'framer-motion';

// Enter/exit animations finish instantly, so the return chip's removal doesn't hang on
// jsdom's frame timing. What is animated is not under test here.
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
  };
});

// The fusion controller: its indoor reading is whatever the test sets.
const fake = vi.hoisted(() => ({ indoor: null, listeners: new Set(), started: 0 }));
// Who is signed in: the owner's email makes isAdmin true in App.jsx.
const signedIn = vi.hoisted(() => ({ email: null }));

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback({ uid: 'u-self', displayName: 'Alpha', photoURL: null, email: signedIn.email });
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
// The Google engine without its canvas: children are placed as plain divs carrying their
// lat/lng, exactly the elements App.jsx hands google-map-react.
vi.mock('google-map-react', () => ({
  default: function FakeGoogleMap({ children, onGoogleApiLoaded }) {
    useEffect(() => {
      onGoogleApiLoaded?.({ map: { setTilt() {} } });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="google-map">{children}</div>;
  },
}));
vi.mock('../src/utils/wifiFusion.js', () => ({
  startWifiFusion: () => {
    fake.started++;
    return {
      resolve: (gps) =>
        fake.indoor
          ? { lat: fake.indoor.lat, lng: fake.indoor.lng, positionSource: 'wifi' }
          : { lat: gps.lat, lng: gps.lng, positionSource: 'gps' },
      indoor: () => fake.indoor,
      subscribe: (listener) => {
        fake.listeners.add(listener);
        return () => fake.listeners.delete(listener);
      },
      stop: () => {},
    };
  },
}));
// The survey table, for the floor picker in a building you're in without a reading.
vi.mock('../src/utils/wifiPositioning.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessPoints: async () =>
    new Map([0, 1, 2, 7].map((floor) => [`ap-${floor}`, { lat: 0, lng: 0, building: 'TECH PARK', floor, ambiguousFloor: false }])),
}));
vi.mock('../src/hooks/useLiveUpdate.js', () => ({
  useLiveUpdate: () => ({ status: 'idle', supported: false, restart: vi.fn() }),
}));
vi.mock('../src/hooks/useAppUpdate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAppUpdate: () => ({
      supported: false, status: actual.UpdateStatus.IDLE, manifest: null, installedVersion: null,
      progress: { percent: -1, loaded: 0, total: 0 }, error: null, mandatory: false, dismissed: false,
      check: vi.fn(), startDownload: vi.fn(), openInstallSettings: vi.fn(), dismiss: vi.fn(),
    }),
  };
});

// Real App renders, twice over (both engines), and react-leaflet in jsdom is slow.
vi.setConfig({ testTimeout: 20_000 });

const CODE = 'KTR7X9';
const GPS = { lat: 12.8231, lng: 80.0442 };
const INDOOR = { lat: 12.8246, lng: 80.0453, building: 'TECH PARK', floor: 2, confidence: 0.8, floors: [0, 1, 2, 7] };

/** A fresh App with WIFI_POSITIONING_ENABLED on and the squad flag as given. */
async function loadApp({ share, engine }) {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', engine === 'google' ? 'test-key' : '');
  vi.doMock('../src/utils/positionSource.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      WIFI_POSITIONING_ENABLED: true,
      SHOW_INDOOR_POSITION_TO_SQUAD: share,
    };
  });
  return (await import('../src/App.jsx')).default;
}

async function joinSquad(App) {
  render(createElement(App));
  fireEvent.click(screen.getByRole('button', { name: 'JOIN SQUAD' }));
  fireEvent.change(screen.getByPlaceholderText('E.G. KTR7X9'), { target: { value: CODE } });
  fireEvent.click(screen.getByRole('button', { name: /connect to squad/i }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: CODE }));
  await waitFor(() => expect(fake.started).toBe(1));
  await waitFor(() => expect(fake.listeners.size).toBe(1));
}

const setIndoor = (reading) =>
  act(() => {
    fake.indoor = reading && { ...reading, expiresAt: Date.now() + 70_000 };
    fake.listeners.forEach((listener) => listener());
  });

const squadUpdate = (members) =>
  act(() => fakeSocket.receive('users-update', Object.fromEntries(members.map((m) => [m.id, { roomCode: CODE, speed: 0, heading: 0, battery: 80, lastSeen: 1, ...m }]))));

const BRAVO = { id: 'bravo-socket', uid: 'u-bravo', name: 'Bravo', lat: 12.8247, lng: 80.0454, positionSource: 'wifi', building: 'TECH PARK', floor: 7 };
const CHARLIE = { id: 'charlie-socket', uid: 'u-charlie', name: 'Charlie', lat: 12.8260, lng: 80.0470, positionSource: 'gps' };

/** The payload of the next heartbeat update-location (standard polling: every 5 s). */
async function nextHeartbeat() {
  fakeSocket.emit.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(5000));
  const calls = fakeSocket.emit.mock.calls.filter(([event]) => event === 'update-location');
  expect(calls.length).toBeGreaterThan(0);
  return calls.at(-1)[1];
}

const halo = () => document.querySelector('[data-testid="indoor-halo"]');
const floorTabs = () => screen.queryByRole('tablist');
const tab = (label) => within(floorTabs()).getByRole('tab', { name: new RegExp(`^${label}\\b`) });
const pill = (text) => screen.queryByText(text);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  fake.indoor = null;
  fake.listeners.clear();
  fake.started = 0;
  signedIn.email = null;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: GPS.lat, longitude: GPS.lng, speed: 0 } })),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.doUnmock('../src/utils/positionSource.js');
  delete navigator.geolocation;
});

describe.each(['google', 'leaflet'])('on the %s engine', (engine) => {
  describe('WiFi on, squad flag off', () => {
    it('shows your indoor dot with a halo and the floor picker, and falls back cleanly', async () => {
      const App = await loadApp({ share: false, engine });
      await joinSquad(App);
      expect(floorTabs()).toBeNull();
      expect(halo()).toBeNull();

      setIndoor(INDOOR);
      await waitFor(() => expect(halo()).not.toBeNull());
      expect(within(floorTabs()).getAllByRole('tab').map((t) => t.textContent)).toEqual(['F7', 'F2', 'F1', 'G']);
      expect(within(tab('F2')).getByTestId('live-floor-dot')).toBeTruthy();
      expect(tab('F2').getAttribute('aria-selected')).toBe('true');
      expect(halo().style.width).toBe('84px'); // radius 42 at confidence 0.8

      // Signal lost: the plain GPS dot, nothing else, no error.
      setIndoor(null);
      await waitFor(() => expect(halo()).toBeNull());
      expect(floorTabs()).toBeNull();
      expect(screen.queryByText(/error|lost/i)).toBeNull();
    });

    it('sends no floor or building, indoors or not', async () => {
      const App = await loadApp({ share: false, engine });
      await joinSquad(App);
      setIndoor(INDOOR);
      const payload = await nextHeartbeat();
      expect(payload).toMatchObject({ lat: INDOOR.lat, lng: INDOOR.lng, positionSource: 'wifi' });
      expect(payload).not.toHaveProperty('floor');
      expect(payload).not.toHaveProperty('building');
      expect(payload).not.toHaveProperty('indoorPosition');
    });

    it("ignores a squadmate's floor", async () => {
      const App = await loadApp({ share: false, engine });
      await joinSquad(App);
      squadUpdate([BRAVO]);
      fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' })[0]);
      await screen.findAllByText('Bravo');
      expect(pill('BRAVO · F7')).toBeNull();
      expect(screen.queryByTestId('member-floor-chip')).toBeNull();
    });
  });

  describe('WiFi on, squad flag on', () => {
    it('broadcasts your real floor, never the one you are browsing', async () => {
      const App = await loadApp({ share: true, engine });
      await joinSquad(App);

      expect(await nextHeartbeat()).not.toHaveProperty('floor'); // no reading yet: keys omitted

      setIndoor(INDOOR);
      await waitFor(() => expect(floorTabs()).not.toBeNull());
      const indoors = await nextHeartbeat();
      expect(indoors).toMatchObject({ lat: INDOOR.lat, lng: INDOOR.lng, positionSource: 'wifi', building: 'TECH PARK', floor: 2 });
      expect(indoors).not.toHaveProperty('indoorPosition');

      fireEvent.click(tab('F7'));
      expect(tab('F7').getAttribute('aria-selected')).toBe('true');
      await waitFor(() => expect(halo()).toBeNull()); // you are not on F7
      expect(await nextHeartbeat()).toEqual(indoors);

      setIndoor(null);
      const outside = await nextHeartbeat();
      expect(outside).toMatchObject({ lat: GPS.lat, lng: GPS.lng, positionSource: 'gps' });
      expect(outside).not.toHaveProperty('floor');
      expect(outside).not.toHaveProperty('building');
    });

    it('offers the way back after browsing a while', async () => {
      const App = await loadApp({ share: true, engine });
      await joinSquad(App);
      setIndoor(INDOOR);
      await waitFor(() => expect(floorTabs()).not.toBeNull());

      fireEvent.click(tab('G'));
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(screen.queryByRole('button', { name: 'Return to F2' })).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(600));
      fireEvent.click(screen.getByRole('button', { name: 'Return to F2' }));
      expect(tab('F2').getAttribute('aria-selected')).toBe('true');

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Return to F2' })).toBeNull());
      await waitFor(() => expect(halo()).not.toBeNull());
    });

    it("shows squadmates' floors on the map and roster, dims other floors, and drops the floor alone when they leave", async () => {
      const App = await loadApp({ share: true, engine });
      await joinSquad(App);
      setIndoor(INDOOR);
      squadUpdate([BRAVO, CHARLIE]);

      // Map: Bravo tagged and dimmed (F7 while you view F2); Charlie, outdoors, neither.
      const bravoPill = await screen.findByText('BRAVO · F7');
      expect(bravoPill.parentElement.style.opacity).toBe('0.35');
      expect(screen.queryByText(/CHARLIE ·/)).toBeNull();

      // Viewing F7 un-dims Bravo.
      fireEvent.click(tab('F7'));
      await waitFor(() => expect(screen.getByText('BRAVO · F7').parentElement.style.opacity).toBe(''));

      // Roster: a floor chip on Bravo's card only, beside the direction finder.
      fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' })[0]);
      const chips = await screen.findAllByTestId('member-floor-chip');
      expect(chips.map((c) => c.textContent)).toEqual(['TECH PARK · F7']);

      // Bravo walks out: the next update has no floor. Pill and chip go; the card's
      // distance and direction stay.
      const { building: _b, floor: _f, ...bravoOutside } = BRAVO;
      squadUpdate([{ ...bravoOutside, positionSource: 'gps', lastSeen: 2 }, CHARLIE]);
      await waitFor(() => expect(pill('BRAVO · F7')).toBeNull());
      expect(screen.queryByTestId('member-floor-chip')).toBeNull();
      const bravoCard = screen.getAllByText('Bravo').find((el) => el.tagName === 'H4').closest('.relative');
      expect(bravoCard.textContent).toMatch(/\bM\b|KM/);
    });
  });
});

describe('the WiFi field-test readout', () => {
  it('is shown to the owner', async () => {
    signedIn.email = 'vithyakrish1402@gmail.com';
    const App = await loadApp({ share: false, engine: 'leaflet' });
    await joinSquad(App);
    expect(await screen.findByTestId('wifi-readout')).toBeTruthy();
  });

  it('is never shown to anyone else', async () => {
    signedIn.email = 'someone@example.com';
    const App = await loadApp({ share: false, engine: 'leaflet' });
    await joinSquad(App);
    setIndoor(INDOOR);
    await waitFor(() => expect(floorTabs()).not.toBeNull());
    expect(screen.queryByTestId('wifi-readout')).toBeNull();
  });
});

describe("a squadmate's floor chip", () => {
  it('shows even when you have no GPS fix of your own to aim the direction finder with', async () => {
    navigator.geolocation.getCurrentPosition = vi.fn((_ok, fail) => fail({ code: 1, message: 'User denied Geolocation' }));
    const App = await loadApp({ share: true, engine: 'leaflet' });
    await joinSquad(App);
    squadUpdate([BRAVO]);
    fireEvent.click(screen.getAllByRole('button', { name: 'SQUAD' })[0]);
    await screen.findByText('AWAITING_GPS_FIX');
    expect(screen.getByTestId('member-floor-chip').textContent).toBe('TECH PARK · F7');
  });
});

describe('where your own dot is drawn (Google engine)', () => {
  it('at the WiFi position while indoors, back on GPS after', async () => {
    const App = await loadApp({ share: false, engine: 'google' });
    await joinSquad(App);
    const selfDiv = () => document.querySelector('[data-testid="google-map"] > div[lat]');
    await waitFor(() => expect(selfDiv()?.getAttribute('lat')).toBe(String(GPS.lat)));

    setIndoor(INDOOR);
    await waitFor(() => expect(selfDiv().getAttribute('lat')).toBe(String(INDOOR.lat)));
    expect(selfDiv().getAttribute('lng')).toBe(String(INDOOR.lng));

    setIndoor(null);
    await waitFor(() => expect(selfDiv().getAttribute('lat')).toBe(String(GPS.lat)));
  });
});

describe('the floor picker without a WiFi reading', () => {
  // Inside TECH PARK's footprint (surveyed) and UNIVERSITY BUILDING's (never surveyed).
  const IN_TECH_PARK = { lat: 12.8246325, lng: 80.0453585 };
  const IN_UNIVERSITY_BUILDING = { lat: 12.8234851, lng: 80.042357 };
  const gpsAt = ({ lat, lng }) => {
    navigator.geolocation.getCurrentPosition = vi.fn((ok) => ok({ coords: { latitude: lat, longitude: lng, speed: 0 } }));
  };
  const noFloors = () => screen.queryByRole('status', { name: /no floors available/ });

  it.each(['google', 'leaflet'])('shows the surveyed floors in a building you are in, with none open (%s)', async (engine) => {
    gpsAt(IN_TECH_PARK);
    const App = await loadApp({ share: true, engine });
    await joinSquad(App);
    squadUpdate([BRAVO]);

    await waitFor(() => expect(floorTabs()).not.toBeNull());
    expect(within(floorTabs()).getAllByRole('tab').map((t) => t.textContent)).toEqual(['F7', 'F2', 'F1', 'G']);
    expect(within(floorTabs()).queryByTestId('live-floor-dot')).toBeNull();
    expect(within(floorTabs()).getAllByRole('tab').every((t) => t.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(halo()).toBeNull();

    // No tab open: nobody dimmed. Open G: Bravo, on F7, dims. Tap G again: back to none.
    const bravo = () => screen.getByText('BRAVO · F7').parentElement.style.opacity;
    await waitFor(() => expect(bravo()).toBe(''));
    fireEvent.click(tab('G'));
    await waitFor(() => expect(bravo()).toBe('0.35'));
    fireEvent.click(tab('G'));
    await waitFor(() => expect(bravo()).toBe(''));
  });

  it('opens on your live floor once a reading arrives, whatever you had picked', async () => {
    gpsAt(IN_TECH_PARK);
    const App = await loadApp({ share: false, engine: 'leaflet' });
    await joinSquad(App);
    await waitFor(() => expect(floorTabs()).not.toBeNull());
    fireEvent.click(tab('F7'));

    setIndoor(INDOOR);
    await waitFor(() => expect(halo()).not.toBeNull());
    expect(tab('F2').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: /Return to/ })).toBeNull();
  });

  it('still shows in a building the survey never covered, saying it has no floors', async () => {
    gpsAt(IN_UNIVERSITY_BUILDING);
    const App = await loadApp({ share: false, engine: 'leaflet' });
    await joinSquad(App);
    await waitFor(() => expect(noFloors()).not.toBeNull());
    expect(noFloors().getAttribute('aria-label')).toBe('UNIVERSITY BUILDING: no floors available');
    expect(floorTabs()).toBeNull();
  });

  it('is absent outdoors', async () => {
    const App = await loadApp({ share: false, engine: 'leaflet' });
    await joinSquad(App);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(floorTabs()).toBeNull();
    expect(noFloors()).toBeNull();
  });
});
