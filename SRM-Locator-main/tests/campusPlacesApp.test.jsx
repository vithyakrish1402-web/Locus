// @vitest-environment jsdom
//
// Places the admin adds in the app, driven through the real App.jsx: they join the list and the
// search (by name or short name), grounds get their own pill and no floors, and only the admin
// can add one - tap the map, fill the form, save - with the Firestore store faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
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
    receive: (event, payload) => handlers.get(event)?.forEach((fn) => fn(payload)),
  };
});
const who = vi.hoisted(() => ({ user: { uid: 'u-self', displayName: 'Alpha', photoURL: null, email: 'someone@example.com' } }));
const store = vi.hoisted(() => ({ docs: [], save: null, remove: null }));
const ADMIN = 'vithyakrish1402@gmail.com';

vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));
vi.mock('../src/firebase.js', () => ({ auth: { currentUser: null }, googleProvider: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth, callback) => {
    callback(who.user);
    return () => {};
  },
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../src/utils/campusPlacesStore.js', () => ({
  readCachedPlaces: () => [],
  fetchCampusPlaces: async () => store.docs.map((d) => ({ ...d })),
  saveCampusPlace: (fields) => store.save(fields),
  removeCampusPlace: (id) => store.remove(id),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: () => Promise.resolve({ remove: () => {} }), minimizeApp: vi.fn() },
}));
vi.mock('google-map-react', () => ({ default: () => null }));
// In jsdom the Google map never loads, so App falls back to the Leaflet map: here a tap target that
// reports a spot on campus, and says how many places it was given and whether a new spot is chosen.
vi.mock('../src/components/TacticalLeafletMap.jsx', () => ({
  default: ({ onMapClick, places, draftPlace }) => (
    <div data-testid="map" data-places={places.length} data-draft={draftPlace ? `${draftPlace.lat},${draftPlace.lng}` : ''}>
      <button type="button" data-testid="map-tap" onClick={() => onMapClick({ lat: 12.8212, lng: 80.0452 })} />
    </div>
  ),
}));
// AR Scan itself is not under test here, only which places it is handed to tag.
vi.mock('../src/ARCompass.jsx', () => ({
  default: ({ buildings }) => <div data-testid="ar" data-names={buildings.map((b) => b.name).join('|')} />,
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
const { __resetNotifications } = await import('../src/utils/notify.js');
const { SETTINGS } = await import('../src/copy/settings.js');
const { ADD_PLACE_PROBLEMS } = await import('../src/copy/addPlace.js');

const GROUND = { id: 'cp-g1', name: 'DENTAL GROUND', category: 'GROUNDS', lat: 12.8255, lng: 80.0485, info: 'Open ground by the Dental College.', aliases: ['dental maidan'], added: true };

const joinAsMember = async () => {
  fireEvent.click(screen.getByRole('radio', { name: 'Join a group' }));
  fireEvent.change(screen.getByPlaceholderText('e.g. KTR7X9'), { target: { value: 'KTR7X9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Join group' }));
  act(() => fakeSocket.receive('access-granted', { role: 'MEMBER', roomCode: 'KTR7X9' }));
  await screen.findByTestId('map');
};
// The building search is the icon beside LOCUS in the top bar.
const search = (text) => {
  if (!screen.queryByTestId('top-bar-search')) fireEvent.click(screen.getByTestId('top-bar-search-open'));
  fireEvent.change(screen.getByTestId('top-bar-search'), { target: { value: text } });
};
const rows = () => screen.queryAllByTestId('building-row');
const rowNames = () => rows().map((r) => within(r).getByRole('heading').textContent);

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emit.mockClear();
  __resetNotifications();
  who.user = { uid: 'u-self', displayName: 'Alpha', photoURL: null, email: 'someone@example.com' };
  store.docs = [];
  store.save = vi.fn(async (fields) => { store.docs.push({ id: 'cp-new', ...fields, added: true }); return 'new'; });
  store.remove = vi.fn(async (id) => { store.docs = store.docs.filter((d) => d.id !== id); });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
  });
});
afterEach(() => {
  cleanup();
  delete navigator.geolocation;
});

describe('an added place', () => {
  it('is in the list and the map, found by its name or a short name, and a ground gets its own pill', async () => {
    store.docs = [GROUND];
    render(<App />);
    await joinAsMember();
    expect(await screen.findByText('DENTAL GROUND')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Grounds/ })).toBeTruthy();
    // The map is given every place, the added one too.
    expect(Number(screen.getByTestId('map').dataset.places)).toBe(rows().length);

    search('dental maidan');
    await waitFor(() => expect(rowNames()).toEqual(['DENTAL GROUND']));
    search('dental gro');
    await waitFor(() => expect(rowNames()).toEqual(['DENTAL GROUND']));
    search('nothing like this');
    await waitFor(() => expect(rows()).toHaveLength(0));
  });

  it('shows no Grounds pill, and nothing extra, when none has been added', async () => {
    render(<App />);
    await joinAsMember();
    await screen.findAllByTestId('building-row');
    expect(screen.queryByRole('button', { name: /Grounds/ })).toBeNull();
  });

  it('a ground opens a card with no floor count or facilities', async () => {
    store.docs = [GROUND];
    render(<App />);
    await joinAsMember();
    fireEvent.click(await screen.findByText('DENTAL GROUND'));
    const card = await screen.findByTestId('location-card');
    expect(within(card).getByText('Campus Ground')).toBeTruthy();
    expect(card.textContent).not.toMatch(/Floors|Elevator|Facilities/);
  });

  it('a ground can be scanned for, but is not handed to AR Scan as a building to tag', async () => {
    try { localStorage.setItem('locus.cameraAllowed', '1'); } catch { /* no storage */ }
    store.docs = [GROUND];
    render(<App />);
    await joinAsMember();
    await screen.findByText('DENTAL GROUND');
    search('dental ground');
    await waitFor(() => expect(rowNames()).toEqual(['DENTAL GROUND']));
    await act(async () => fireEvent.click(within(rows()[0]).getByRole('button', { name: /AR Scan/ })));
    const ar = await screen.findByTestId('ar');
    expect(ar.dataset.names).toContain('TECH PARK');
    expect(ar.dataset.names).not.toContain('DENTAL GROUND');
  });

  it('cannot take the name of a built-in building', async () => {
    store.docs = [{ ...GROUND, id: 'cp-g2', name: 'tech park' }];
    render(<App />);
    await joinAsMember();
    await screen.findAllByTestId('building-row');
    search('tech park');
    await waitFor(() => expect(rowNames()).toEqual(['TECH PARK', 'TECH PARK 2']));
    expect(rows()[0].textContent).not.toMatch(/Open ground/);
  });
});

describe('Add Place', () => {
  const openAddPlace = async () => {
    who.user = { ...who.user, email: ADMIN };
    render(<App />);
    await joinAsMember();
    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    fireEvent.click(within(screen.getByTestId('settings')).getByRole('button', { name: new RegExp(SETTINGS.adminTools) }));
    fireEvent.click(screen.getByRole('button', { name: /ADD_PLACE/ }));
  };

  it('is not offered to anyone but the admin, and a map tap then does nothing', async () => {
    render(<App />);
    await joinAsMember();
    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    expect(within(screen.getByTestId('settings')).queryByRole('button', { name: new RegExp(SETTINGS.adminTools) })).toBeNull();
    fireEvent.click(screen.getByTestId('map-tap'));
    expect(screen.queryByTestId('add-place')).toBeNull();
    expect(screen.queryByTestId('placing-bar')).toBeNull();
  });

  it('asks for a tap on the map, then a form for that spot, and saves it for everyone', async () => {
    await openAddPlace();
    expect(screen.getByTestId('placing-bar')).toBeTruthy();
    expect(screen.queryByTestId('add-place')).toBeNull();

    fireEvent.click(screen.getByTestId('map-tap'));
    const form = await screen.findByTestId('add-place');
    expect(screen.queryByTestId('placing-bar')).toBeNull();
    expect(form.textContent).toContain('12.821200, 80.045200');
    // The map shows the chosen spot until the place is saved.
    expect(screen.getByTestId('map').dataset.draft).toBe('12.8212,80.0452');

    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'srm fablab' } });
    fireEvent.change(within(form).getByLabelText(/Other names/), { target: { value: 'fab lab, FabLab' } });
    fireEvent.change(within(form).getByLabelText('Kind of place'), { target: { value: 'ENGINEERING' } });
    fireEvent.click(within(form).getByRole('button', { name: 'SAVE PLACE' }));

    await waitFor(() => expect(store.save).toHaveBeenCalledTimes(1));
    expect(store.save).toHaveBeenCalledWith({
      name: 'SRM FABLAB', category: 'ENGINEERING', lat: 12.8212, lng: 80.0452, info: '', aliases: ['fab lab', 'FabLab'],
    });
    await waitFor(() => expect(screen.queryByTestId('add-place')).toBeNull());
    expect(screen.getByTestId('map').dataset.draft).toBe('');
    // It is on the list at once, and findable by its short name.
    search('fab lab');
    await waitFor(() => expect(rowNames()).toEqual(['SRM FABLAB']));
  });

  it('refuses a name already on the map, keeps the form open, and saves nothing', async () => {
    await openAddPlace();
    fireEvent.click(screen.getByTestId('map-tap'));
    const form = await screen.findByTestId('add-place');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Tech Park' } });
    fireEvent.click(within(form).getByRole('button', { name: 'SAVE PLACE' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(ADD_PLACE_PROBLEMS.duplicate);
    expect(store.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('add-place')).toBeTruthy();
  });

  it('says so when the database refuses the write, and keeps the form for another try', async () => {
    store.save = vi.fn(async () => { throw Object.assign(new Error('no'), { code: 'permission-denied' }); });
    await openAddPlace();
    fireEvent.click(screen.getByTestId('map-tap'));
    const form = await screen.findByTestId('add-place');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Civil Block' } });
    fireEvent.click(within(form).getByRole('button', { name: 'SAVE PLACE' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(ADD_PLACE_PROBLEMS.denied);
    expect(within(form).getByRole('button', { name: 'SAVE PLACE' }).disabled).toBe(false);
  });

  it('Cancel on the bar, or on the form, drops the spot without saving', async () => {
    await openAddPlace();
    fireEvent.click(within(screen.getByTestId('placing-bar')).getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByTestId('placing-bar')).toBeNull();
    fireEvent.click(screen.getByTestId('map-tap'));
    expect(screen.queryByTestId('add-place')).toBeNull();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('the admin can remove a place they added', async () => {
    store.docs = [GROUND];
    who.user = { ...who.user, email: ADMIN };
    render(<App />);
    await joinAsMember();
    fireEvent.click(screen.getAllByRole('button', { name: SETTINGS.open })[0]);
    fireEvent.click(within(screen.getByTestId('settings')).getByRole('button', { name: new RegExp(SETTINGS.adminTools) }));
    const list = await screen.findByTestId('added-places');
    fireEvent.click(within(list).getByRole('button', { name: 'Remove DENTAL GROUND' }));
    await waitFor(() => expect(store.remove).toHaveBeenCalledWith('cp-g1'));
    await waitFor(() => expect(screen.queryByTestId('added-places')).toBeNull());
  });
});
