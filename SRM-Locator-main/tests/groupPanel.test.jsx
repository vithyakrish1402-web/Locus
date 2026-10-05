// @vitest-environment jsdom
//
// The group panel (redesign Group panel batch), through the real App.jsx: its header, the
// Members and Buildings tabs and search, your sharing control, the Group Lead's tools, member
// rows and options, join requests, leaving, its three heights and its states. Only the app's
// edges are stubbed (socket transport, Firebase, native plugins, the update hooks).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

// Rows leave at once (no exit animation to wait out in jsdom).
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
const { GROUP_HEADER, GROUP_TABS } = await import('../src/copy/group.js');

const HERE = { lat: 12.8230, lng: 80.0440 };
let code;
const member = (id, extra = {}) => ({
  [`sock-${id}`]: { uid: `u-${id}`, name: id, roomCode: code, lat: HERE.lat + 0.001, lng: HERE.lng, speed: 0, heading: 0, battery: 90, status: 'ACTIVE', lastSeen: Date.now(), ...extra },
});

/** On the map in a group: the Group Lead of one you created, or a member of one you joined. */
const inAGroup = async ({ lead = true, members = {} } = {}) => {
  render(<App />);
  code = document.querySelector('.sr-only').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
  act(() => fakeSocket.receive('access-granted', { role: lead ? 'OWNER' : 'MEMBER', roomCode: code }));
  await act(async () => {});
  if (typeof members === 'function') members = members();
  if (Object.keys(members).length) act(() => fakeSocket.receive('users-update', members));
};
const panel = () => within(screen.getByTestId('group-panel-list'));
const header = () => within(screen.getByTestId('group-header'));
const tab = (name) => fireEvent.click(screen.getByRole('radio', { name }));

beforeEach(() => {
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

describe('the header', () => {
  it('says "Your group", the Group Lead role and the code, spaced', async () => {
    await inAGroup();
    expect(header().getByRole('heading', { name: GROUP_HEADER.title })).toBeTruthy();
    expect(header().getByText(GROUP_HEADER.lead)).toBeTruthy();
    expect(header().getByTestId('group-code').textContent).toBe(`Code ${code.slice(0, 3)} ${code.slice(3)}`);
  });

  it('a member is a Member', async () => {
    await inAGroup({ lead: false });
    expect(header().getByText(GROUP_HEADER.member)).toBeTruthy();
    expect(header().queryByText(GROUP_HEADER.lead)).toBeNull();
  });

  it('Copy copies the code and says so (no share sheet: Copy only)', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await inAGroup();
    await act(async () => { fireEvent.click(header().getByRole('button', { name: GROUP_HEADER.copy })); });
    expect(writeText).toHaveBeenCalledWith(code);
    expect(header().getByRole('button', { name: GROUP_HEADER.copied })).toBeTruthy();
    expect(header().queryByRole('button', { name: /share/i })).toBeNull();
    delete navigator.clipboard;
  });
});

describe('the Members and Buildings tabs, and search', () => {
  it('two tabs, in plain words', async () => {
    await inAGroup();
    expect(screen.getByRole('radiogroup', { name: GROUP_TABS.label })).toBeTruthy();
    tab(GROUP_TABS.buildings);
    expect(panel().getAllByTestId('building-row').length).toBeGreaterThan(5);
    tab(GROUP_TABS.members);
    await waitFor(() => expect(panel().queryAllByTestId('building-row')).toHaveLength(0));
    expect(document.body.textContent).not.toMatch(/MATRIX|SEARCH_/);
  });

  it('search finds buildings by name', async () => {
    await inAGroup();
    tab(GROUP_TABS.buildings);
    fireEvent.change(panel().getByRole('searchbox', { name: GROUP_TABS.searchBuildings }), { target: { value: 'tech park' } });
    await waitFor(() => {
      const names = panel().getAllByTestId('building-row').map((r) => r.querySelector('h4').textContent);
      expect(names.length).toBeGreaterThan(0);
      names.forEach((n) => expect(n).toMatch(/TECH PARK/));
    });
  });

  it('search finds members by name too (it used to filter nothing there)', async () => {
    await inAGroup({ members: () => ({ ...member('Meera'), ...member('Aarav') }) });
    tab(GROUP_TABS.members);
    expect(panel().getByText('Meera')).toBeTruthy();
    fireEvent.change(panel().getByRole('searchbox', { name: GROUP_TABS.searchMembers }), { target: { value: 'aar' } });
    await waitFor(() => expect(panel().queryByText('Meera')).toBeNull());
    expect(panel().getByText('Aarav')).toBeTruthy();
  });
});

describe('your location: Live, Paused or Hidden', () => {
  const help = () => screen.getByTestId('sharing-help').textContent;
  const mode = (name) => fireEvent.click(screen.getByRole('radio', { name }));
  const checked = () => within(screen.getByRole('radiogroup', { name: 'Your location' })).getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true').textContent;

  it('three modes in plain words, Live to start, never the old tactical words', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    expect(checked()).toBe('Live');
    expect(help()).toBe('The group sees you move, updated every 5 seconds.');
    expect(screen.getByTestId('sharing-control').textContent).not.toMatch(/ACTIVE|FROZEN|GHOST|TELEMETRY/);
  });

  it('each mode says what the group sees, and sends the same status as before', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    mode('Paused');
    expect(checked()).toBe('Paused');
    expect(help()).toBe('The group sees the last place you shared, not where you are now.');
    expect(fakeSocket.emit.mock.calls.filter(([e, d]) => e === 'update-location' && d.status === 'FROZEN').length).toBeGreaterThan(0);
    mode('Hidden');
    expect(help()).toBe("Other members won't see you on their map.");
    expect(fakeSocket.emit.mock.calls.filter(([e, d]) => e === 'update-location' && d.status === 'GHOST').length).toBeGreaterThan(0);
    mode('Live');
    expect(checked()).toBe('Live');
  });

  it('never claims more than is shared: live before a fix, and paused with no spot', async () => {
    navigator.geolocation.getCurrentPosition = vi.fn();
    await inAGroup();
    tab(GROUP_TABS.members);
    expect(help()).toBe("Your location will be shared live once it's found.");
    mode('Paused');
    expect(help()).toBe("No spot has been shared yet, so the group won't see you on their map.");
  });
});

describe("a member's options", () => {
  const options = (name) => within(screen.getByRole('dialog', { name: `Options for ${name}` }));
  const open = async (lead, extra = {}) => {
    await inAGroup({ lead, members: () => member('Meera Iyer', extra) });
    tab(GROUP_TABS.members);
    fireEvent.click(panel().getByRole('button', { name: 'Options for Meera Iyer' }));
  };
  const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event);

  it('Ping, Show on map and Find with AR Scan for anyone; Remove and block only for the Group Lead', async () => {
    await open(false);
    expect(options('Meera Iyer').getByRole('button', { name: 'Ping Meera' })).toBeTruthy();
    expect(options('Meera Iyer').getByRole('button', { name: 'Show on map' })).toBeTruthy();
    expect(options('Meera Iyer').getByRole('button', { name: 'Find with AR Scan' })).toBeTruthy();
    expect(options('Meera Iyer').queryByRole('button', { name: 'Remove and block' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Options for Meera Iyer' }).textContent).not.toMatch(/Vote|Navigate to/);
  });

  it("shows their battery and speed, which the row doesn't", async () => {
    await open(true, { battery: 64, speed: 4 });
    expect(screen.getByTestId('member-options').textContent).toContain('Battery 64% · 4 km/h');
  });

  it('Ping pings them', async () => {
    await open(false);
    fireEvent.click(options('Meera Iyer').getByRole('button', { name: 'Ping Meera' }));
    expect(emitted('ping-user')[0][1]).toMatchObject({ targetId: 'sock-Meera Iyer' });
  });

  it('with no fix: Ping only, nothing that would aim at nowhere', async () => {
    await open(false, { lat: null, lng: null });
    expect(options('Meera Iyer').getByRole('button', { name: 'Ping Meera' })).toBeTruthy();
    expect(options('Meera Iyer').queryByRole('button', { name: 'Show on map' })).toBeNull();
    expect(options('Meera Iyer').queryByRole('button', { name: 'Find with AR Scan' })).toBeNull();
  });

  it('Remove and block asks first, in words that never mention unblocking, and only then blocks', async () => {
    await open(true);
    fireEvent.click(options('Meera Iyer').getByRole('button', { name: 'Remove and block' }));
    expect(emitted('block-user')).toEqual([]);
    const confirm = screen.getByRole('dialog', { name: 'Remove and block Meera Iyer?' });
    expect(confirm.textContent).toContain("Meera is removed from your group straight away and can't ask to join again.");
    expect(confirm.textContent).not.toMatch(/unblock|Blocked/i);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove and block' }));
    expect(emitted('block-user')).toEqual([['block-user', { roomCode: code, targetId: 'sock-Meera Iyer' }]]);
    await waitFor(() => expect(panel().queryByText('Meera Iyer')).toBeNull());
  });

  it('Cancel on the confirmation blocks no one', async () => {
    await open(true);
    fireEvent.click(options('Meera Iyer').getByRole('button', { name: 'Remove and block' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove and block Meera Iyer?' })).getByRole('button', { name: 'Cancel' }));
    expect(emitted('block-user')).toEqual([]);
    expect(panel().getByText('Meera Iyer')).toBeTruthy();
  });

  it('the Remove and block button is red, and nothing else in the sheet is', async () => {
    await open(true);
    const sheet = screen.getByTestId('member-options');
    const red = [...sheet.querySelectorAll('button')].filter((b) => /danger/.test(b.innerHTML + b.className));
    expect(red.map((b) => b.textContent)).toEqual(['Remove and block']);
  });
});
