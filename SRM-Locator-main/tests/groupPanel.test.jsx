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

describe("the Group Lead's tools", () => {
  const tools = () => within(screen.getByTestId('lead-tools'));
  const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event);

  it('only for the Group Lead: Join requests, Refresh locations and Meeting point', async () => {
    await inAGroup({ lead: false });
    tab(GROUP_TABS.members);
    expect(screen.queryByTestId('lead-tools')).toBeNull();
    cleanup();
    await inAGroup();
    tab(GROUP_TABS.members);
    expect(tools().getByRole('button', { name: /^Join requests/ })).toBeTruthy();
    expect(tools().getByRole('button', { name: 'Refresh locations' })).toBeTruthy();
    expect(tools().getByRole('button', { name: 'Meeting point' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NODE_ACCESS|SYNC_TELEMETRY|RALLY POINT|DISCONNECT|ACTIVE_CHANNEL/);
  });

  it('Join requests shows how many are waiting', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    act(() => fakeSocket.receive('access-request', { targetId: 's-kavya', name: 'Kavya Nair', roomCode: code }));
    act(() => fakeSocket.receive('access-request', { targetId: 's-vikram', name: 'Vikram Rao', roomCode: code }));
    expect(tools().getByRole('button', { name: /^Join requests/ }).textContent).toContain('2');
    expect(tools().getByLabelText('2 waiting')).toBeTruthy();
  });

  it("Refresh locations asks the server, and a failure says why in amber, with Retry", async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    fakeSocket.connected = false;
    fireEvent.click(tools().getByRole('button', { name: 'Refresh locations' }));
    const notice = screen.getByTestId('refresh-failed');
    expect(notice.textContent).toContain("Couldn't refresh locations.");
    expect(notice.className).toMatch(/warning/);
    expect(notice.outerHTML).not.toMatch(/red-|danger/);
    fakeSocket.connected = true;
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(screen.queryByTestId('refresh-failed')).toBeNull();
  });

  it('Meeting point: choose a spot on the map, as the map button does', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    const button = tools().getByRole('button', { name: 'Meeting point' });
    fireEvent.click(button);
    expect(tools().getByRole('button', { name: 'Cancel' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('meeting-point-button').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tools().getByRole('button', { name: 'Cancel' }));
    expect(tools().getByRole('button', { name: 'Meeting point' }).getAttribute('aria-pressed')).toBe('false');
    expect(emitted('publish-waypoint')).toEqual([]);
  });

  it('Remove meeting point while one is set', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    expect(tools().queryByRole('button', { name: 'Remove meeting point' })).toBeNull();
    act(() => fakeSocket.receive('new-waypoint', { lat: 12.8231, lng: 80.0442, name: 'RALLY POINT', setBy: 'u-other' }));
    fireEvent.click(tools().getByRole('button', { name: 'Remove meeting point' }));
    expect(emitted('clear-waypoint')).toHaveLength(1);
  });
});

describe('Leave group', () => {
  const confirm = () => screen.getByRole('dialog', { name: 'Leave the group?' });
  const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event);

  it('asks everyone first; Stay in the group leaves no one', async () => {
    await inAGroup({ lead: false });
    tab(GROUP_TABS.members);
    fireEvent.click(screen.getByTestId('leave-group'));
    expect(emitted('leave-squad')).toEqual([]);
    expect(confirm().textContent).toContain('To come back, ask to join again with the code');
    expect(confirm().textContent).not.toMatch(/Group Lead/);
    fireEvent.click(within(confirm()).getByRole('button', { name: 'Stay in the group' }));
    expect(emitted('leave-squad')).toEqual([]);
  });

  it('then leaves', async () => {
    await inAGroup({ lead: false });
    tab(GROUP_TABS.members);
    fireEvent.click(screen.getByTestId('leave-group'));
    fireEvent.click(within(confirm()).getByRole('button', { name: 'Leave group' }));
    expect(emitted('leave-squad')).toHaveLength(1);
  });

  it('tells a Group Lead that leadership passes to another member', async () => {
    await inAGroup({ members: () => member('Meera Iyer') });
    tab(GROUP_TABS.members);
    fireEvent.click(screen.getByTestId('leave-group'));
    expect(confirm().textContent).toContain("You're the Group Lead: leadership passes to another member of the group.");
  });

  it('and a Group Lead alone that the group ends', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    fireEvent.click(screen.getByTestId('leave-group'));
    expect(confirm().textContent).toContain("You're the only one in it, so the group ends when you leave.");
    expect(confirm().textContent).not.toMatch(/passes|ask to join again/);
  });

  it('is red, and the only red in the panel', async () => {
    await inAGroup({ members: () => member('Meera Iyer') });
    tab(GROUP_TABS.members);
    const list = screen.getByTestId('group-panel-list');
    const red = [...list.querySelectorAll('*')].filter((el) => /(^|\s)(text|bg|border)-(danger|red-)/.test(el.getAttribute('class') || ''));
    expect(red.map((el) => el.closest('button')?.dataset.testid)).toEqual(['leave-group']);
  });
});

describe('join requests', () => {
  const sheet = () => within(screen.getByRole('dialog', { name: 'Join requests' }));
  const emitted = (event) => fakeSocket.emit.mock.calls.filter(([e]) => e === event).map(([, d]) => d);
  const ask = (id, name) => act(() => fakeSocket.receive('access-request', { targetId: id, name, roomCode: code }));
  const open = () => fireEvent.click(within(screen.getByTestId('lead-tools')).getByRole('button', { name: /^Join requests/ }));

  it('lists who is waiting, Waiting only: no Blocked tab and no unblock anywhere', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    ask('s-kavya', 'Kavya Nair');
    ask('s-vikram', 'Vikram Rao');
    open();
    expect(sheet().getAllByTestId('join-request').map((r) => r.querySelector('p').textContent)).toEqual(['Kavya Nair', 'Vikram Rao']);
    expect(sheet().getByText('Approved people can see the group on the map and are seen by it.')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Blocked/ })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Join requests' }).textContent).not.toMatch(/block|BLACKLIST|REVOKE|INBOUND/i);
  });

  it('Approve and Decline answer exactly as before, and the person leaves the list', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    ask('s-kavya', 'Kavya Nair');
    ask('s-vikram', 'Vikram Rao');
    open();
    fireEvent.click(sheet().getByRole('button', { name: 'Approve Kavya Nair' }));
    fireEvent.click(sheet().getByRole('button', { name: 'Decline Vikram Rao' }));
    expect(emitted('resolve-access')).toEqual([
      { targetId: 's-kavya', roomCode: code, approved: true },
      { targetId: 's-vikram', roomCode: code, approved: false },
    ]);
    expect(sheet().getByTestId('join-requests-empty').textContent).toContain('No one is waiting');
  });

  it('a request withdrawn while the sheet is open leaves it', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    ask('s-kavya', 'Kavya Nair');
    open();
    act(() => fakeSocket.receive('access-request-withdrawn', { targetId: 's-kavya', roomCode: code }));
    expect(sheet().queryByText('Kavya Nair')).toBeNull();
  });

  it('nothing in it is red', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    ask('s-kavya', 'Kavya Nair');
    open();
    expect(screen.getByTestId('join-requests').outerHTML).not.toMatch(/red-|danger/);
  });
});

// The panel's three heights on a phone (utils/panelHeights.js for where each rests). jsdom has
// no layout, so the panel and its header are given a 412 × 892 phone's heights.
describe('the three heights, on a phone', () => {
  let realMatchMedia;
  let realInner;
  beforeEach(() => {
    realMatchMedia = window.matchMedia;
    realInner = window.innerHeight;
    window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 892 });
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: realInner });
  });

  const sheet = () => screen.getByTestId('group-panel-list').closest('[data-height]');
  const bar = () => within(screen.getByRole('navigation', { name: 'Main' }));
  const openPanel = () => fireEvent.click(bar().getByRole('button', { name: 'Group' }));
  const handle = () => screen.getByTestId('group-header').parentElement;
  const sized = (el, px) => Object.defineProperty(el, 'offsetHeight', { configurable: true, value: px });
  const layOut = () => {
    sized(sheet(), 752);
    sized(handle(), 120);
    act(() => { window.dispatchEvent(new Event('resize')); });
  };
  const yOf = () => Number(/translateY\((-?[\d.]+)px\)/.exec(sheet().style.transform)?.[1] ?? 0);
  // jsdom's pointer events carry no pageX/pageY, which framer-motion's drag reads.
  const pointer = (type, y) => {
    const event = new PointerEvent(type, { bubbles: true, clientX: 200, clientY: y, pointerId: 1, isPrimary: true, button: 0, pointerType: 'touch' });
    Object.defineProperty(event, 'pageX', { value: 200 });
    Object.defineProperty(event, 'pageY', { value: y });
    return event;
  };
  /** A tap on the header: press, let go where it was pressed, click. */
  const tapHeader = async () => {
    await act(async () => {
      handle().dispatchEvent(pointer('pointerdown', 300));
      window.dispatchEvent(pointer('pointerup', 300));
    });
    fireEvent.click(handle());
  };
  /** A drag on the handle strip from y0 to y1 (px), then let go. */
  const drag = async (y0, y1, { flick = false } = {}) => {
    const target = handle();
    await act(async () => {
      target.dispatchEvent(pointer('pointerdown', y0));
    });
    for (let i = 1; i <= 6; i++) {
      await act(async () => {
        window.dispatchEvent(pointer('pointermove', y0 + ((y1 - y0) * i) / 6));
        await new Promise((r) => setTimeout(r, flick ? 16 : 120));
      });
    }
    // The finger rests a moment before letting go (a slow let-go: no throw), unless flicked.
    if (!flick) await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    await act(async () => {
      window.dispatchEvent(pointer('pointerup', y1));
      await new Promise((r) => setTimeout(r, 50));
    });
  };

  it('the Group tab opens it at half', async () => {
    await inAGroup();
    expect(sheet().dataset.height).toBe('closed');
    openPanel();
    expect(sheet().dataset.height).toBe('half');
  });

  it('a slow drag down from half rests at peek, and a tap on its header opens it to half again', async () => {
    await inAGroup({ members: () => ({ ...member('Meera Iyer'), ...member('Aarav Shah', { status: 'FROZEN' }) }) });
    openPanel();
    layOut();
    await drag(400, 600);
    expect(sheet().dataset.height).toBe('peek');
    await tapHeader();
    expect(sheet().dataset.height).toBe('half');
  });
  it('a quick flick down from half closes it; a drag up from half opens it full', async () => {
    await inAGroup();
    openPanel();
    layOut();
    await drag(400, 900, { flick: true });
    expect(sheet().dataset.height).toBe('closed');
    openPanel();
    layOut();
    await drag(400, 90);
    expect(sheet().dataset.height).toBe('full');
    // Closed from full, it opens at half again next time.
    await tapHeader();
    expect(sheet().dataset.height).toBe('closed');
    openPanel();
    expect(sheet().dataset.height).toBe('half');
  });

  it('at half, the list has room to scroll its last rows up into view', async () => {
    await inAGroup();
    openPanel();
    layOut();
    const list = screen.getByTestId('group-panel-list');
    // Half rests 325 px below full on this phone (its top at 45 % of 892 px).
    expect(list.lastElementChild.style.height).toBe('325px');
  });

  it('a tap on the header at half closes it, as the handle did', async () => {
    await inAGroup();
    openPanel();
    await tapHeader();
    expect(sheet().dataset.height).toBe('closed');
  });

  it('at peek: the header and who is where, and nothing of the list under the buttons', async () => {
    await inAGroup({ members: () => ({ ...member('Meera Iyer'), ...member('Aarav Shah', { status: 'FROZEN' }), ...member('Rohan Das', { lat: null, lng: null }) }) });
    openPanel();
    expect(screen.getByTestId('peek-lines').closest('[aria-hidden]').getAttribute('aria-hidden')).toBe('true');
    layOut();
    await drag(400, 600);
    expect(sheet().dataset.height).toBe('peek');
    expect(screen.getByTestId('peek-summary').textContent).toBe('1 live · 1 paused · 1 waiting for location');
    expect(screen.getByTestId('peek-lines').closest('[aria-hidden]').getAttribute('aria-hidden')).toBe('false');
    expect(screen.getByTestId('group-panel-list').className).toMatch(/(^|\s)invisible(\s|$)/);
  });

  it('at peek, a Group Lead with requests waiting sees how many, and it opens them', async () => {
    await inAGroup();
    act(() => fakeSocket.receive('access-request', { targetId: 's-kavya', name: 'Kavya Nair', roomCode: code }));
    act(() => fakeSocket.receive('access-request', { targetId: 's-vikram', name: 'Vikram Rao', roomCode: code }));
    openPanel();
    layOut();
    await drag(400, 600);
    const pill = screen.getByTestId('peek-requests');
    expect(pill.textContent).toBe('2 join requests');
    fireEvent.click(pill);
    expect(screen.getByRole('dialog', { name: 'Join requests' })).toBeTruthy();
    expect(sheet().dataset.height).toBe('peek');
  });

  it('no requests pill with none waiting, nor for a member', async () => {
    await inAGroup({ lead: false });
    act(() => fakeSocket.receive('access-request', { targetId: 's-kavya', name: 'Kavya Nair', roomCode: code }));
    openPanel();
    expect(screen.queryByTestId('peek-requests')).toBeNull();
  });

  it('the Emergency button stays above the panel at every height, and peek leaves it room', async () => {
    await inAGroup();
    openPanel();
    layOut();
    const sos = screen.getByRole('button', { name: /SOS beacon/ });
    const z = (el) => Number(el.style.zIndex || /(?:^|\s)z-\[(\d+)\]/.exec(el.className)[1]);
    for (const [from, to, height] of [[400, 600, 'peek'], [600, 90, 'full'], [90, 400, 'half']]) {
      await drag(from, to);
      expect(sheet().dataset.height).toBe(height);
      expect(z(sos)).toBeGreaterThan(z(sheet()));
      expect(sheet().contains(sos)).toBe(false);
    }
    // At peek the header ends above the Emergency button's top (5 rem above the 4 rem tab bar,
    // and 5 rem tall: 160 px from the bottom on this phone).
    await drag(400, 600);
    const shown = 752 - yOf();
    expect(64 + shown - 120).toBeGreaterThanOrEqual(160);
  }, 20000); // four slow drags

  it('notices stay under the panel at peek too, taking no taps from it', async () => {
    const { LAYER } = await import('../src/utils/layers.js');
    await inAGroup();
    openPanel();
    layOut();
    await drag(400, 600);
    act(() => fakeSocket.receive('receive-ping', { senderName: 'Bravo' }));
    expect(Number(screen.getByTestId('comms-feed').style.zIndex)).toBe(LAYER.underGroupPanel);
  });
});

describe('the members list: heading, loading, empty, no match', () => {
  const heading = () => screen.getByTestId('members-heading').textContent;
  const roster = (members) => act(() => fakeSocket.receive('users-update', members));

  it('loads first: "Loading…" and placeholder rows, then how many and when', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    expect(heading()).toBe('MembersLoading…');
    expect(screen.getByTestId('members-loading')).toBeTruthy();
    roster({ ...member('Meera Iyer'), ...member('Aarav Shah') });
    expect(screen.queryByTestId('members-loading')).toBeNull();
    // Everyone in the group, you included.
    expect(heading()).toBe('Members · 3Updated just now');
  });

  it('says how long ago the list came in', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    try {
      await inAGroup({ members: () => member('Meera Iyer') });
      tab(GROUP_TABS.members);
      act(() => { vi.advanceTimersByTime(3 * 60000); });
      expect(heading()).toBe('Members · 2Updated 3 min ago');
    } finally {
      vi.useRealTimers();
    }
  });

  it('just you: says so, with the code to copy, in words for the Group Lead', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await inAGroup();
    tab(GROUP_TABS.members);
    roster({});
    const empty = within(screen.getByTestId('members-empty'));
    expect(empty.getByText('Just you so far')).toBeTruthy();
    expect(screen.getByTestId('members-empty').textContent).toContain('You approve each person before they can see the group.');
    expect(heading()).toBe('Members · 1Updated just now');
    await act(async () => { fireEvent.click(empty.getByRole('button', { name: 'Copy code' })); });
    expect(writeText).toHaveBeenCalledWith(code);
    expect(empty.getByRole('button', { name: 'Code copied' })).toBeTruthy();
    delete navigator.clipboard;
  });

  it('and in words for a member', async () => {
    await inAGroup({ lead: false });
    tab(GROUP_TABS.members);
    roster({});
    expect(screen.getByTestId('members-empty').textContent).toContain('The Group Lead approves each person');
  });

  it('a search that finds no one says so', async () => {
    await inAGroup({ members: () => member('Meera Iyer') });
    tab(GROUP_TABS.members);
    fireEvent.change(panel().getByRole('searchbox', { name: GROUP_TABS.searchMembers }), { target: { value: 'zed' } });
    expect(screen.getByTestId('members-no-match').textContent).toBe('No one called "zed"');
    expect(screen.queryByTestId('members-empty')).toBeNull();
  });

  // Stop 2 leftovers: a building search that found nothing showed a blank list.
  it('a building search that finds nothing says so, and spaces around a name still find it', async () => {
    await inAGroup();
    tab(GROUP_TABS.buildings);
    const box = panel().getByRole('searchbox', { name: GROUP_TABS.searchBuildings });
    fireEvent.change(box, { target: { value: 'zzqx' } });
    expect(screen.getByTestId('buildings-no-match').textContent).toBe('No building called "zzqx"');
    fireEvent.change(box, { target: { value: '  tech park  ' } });
    expect(screen.queryByTestId('buildings-no-match')).toBeNull();
    await act(async () => {});
    expect(screen.getAllByTestId('building-row').map((r) => r.textContent).join(' ')).toMatch(/TECH PARK/);
    fireEvent.change(box, { target: { value: '' } });
    expect(screen.queryByTestId('buildings-no-match')).toBeNull();
  });

  it('leaving the group forgets the list: the next group loads afresh', async () => {
    await inAGroup({ lead: false, members: () => member('Meera Iyer') });
    tab(GROUP_TABS.members);
    fireEvent.click(screen.getByTestId('leave-group'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Leave the group?' })).getByRole('button', { name: 'Leave group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    act(() => fakeSocket.receive('access-granted', { role: 'OWNER', roomCode: code }));
    await act(async () => {});
    tab(GROUP_TABS.members);
    expect(heading()).toBe('MembersLoading…');
  });
});

describe("the order down the panel (so the Group Lead's tools come high at half)", () => {
  it("members: the Group Lead's tools first (clear of the Emergency button at half on a 360 px phone), your location, then the search with the members", async () => {
    await inAGroup({ members: () => member('Meera Iyer') });
    tab(GROUP_TABS.members);
    const order = [
      screen.getByTestId('lead-tools'),
      screen.getByTestId('sharing-control'),
      screen.getByTestId('members-heading'),
      screen.getByRole('searchbox', { name: GROUP_TABS.searchMembers }),
      screen.getAllByTestId('member-row')[0],
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('buildings: the search heads the list', async () => {
    await inAGroup();
    tab(GROUP_TABS.buildings);
    const search = screen.getByRole('searchbox', { name: GROUP_TABS.searchBuildings });
    expect(search.compareDocumentPosition(screen.getAllByTestId('building-row')[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// Owner, Stop 2 (keyboard option 1): on a phone, while a search box has focus (the keyboard is
// up and the screen short), the panel's title and the Group Lead's buttons step aside so the box
// rises clear of the Emergency button; they come back when focus leaves. They move only once the
// tap that moved focus has finished, so that tap's click can't land on whatever slid under it.
// Measured at 412 x 520: the box at 252-296 px, the Emergency button's top at 360.
describe('with the keyboard up, on a phone', () => {
  let realMatchMedia;
  beforeEach(() => {
    realMatchMedia = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => { window.matchMedia = realMatchMedia; });

  const header = () => screen.getByTestId('group-panel-header');
  const leadTools = () => screen.queryByTestId('lead-tools');
  const search = () => screen.getByRole('searchbox', { name: GROUP_TABS.searchMembers });

  it("a focused search box sends the title and the Lead's buttons aside, after the tap, and back on leaving", async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    expect(leadTools()).toBeTruthy();
    fireEvent.focus(search());
    search().focus();
    // Not under the finger: nothing moves until the tap's click is done.
    expect(header().className).not.toMatch(/(^| )hidden /);
    expect(leadTools()).toBeTruthy();
    fireEvent.click(search());
    expect(header().className).toMatch(/(^| )hidden /);
    expect(leadTools()).toBeNull();
    // The Emergency button stays.
    expect(screen.getByTestId('sos-button')).toBeTruthy();
    // Focus leaves: back once that tap is done.
    search().blur();
    fireEvent.blur(search());
    expect(header().className).toMatch(/(^| )hidden /);
    fireEvent.click(document.body);
    expect(header().className).not.toMatch(/(^| )hidden /);
    expect(leadTools()).toBeTruthy();
  });

  it('focus from the keyboard, with no tap, still sends them aside', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    search().focus();
    fireEvent.focus(search());
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(header().className).toMatch(/(^| )hidden /);
  });

  it('a search box focused and left at once changes nothing', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    search().focus();
    fireEvent.focus(search());
    search().blur();
    fireEvent.click(document.body);
    expect(header().className).not.toMatch(/(^| )hidden /);
    // Nor later, when the focus's fallback timer runs.
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(header().className).not.toMatch(/(^| )hidden /);
    expect(leadTools()).toBeTruthy();
  });
});

describe('with a search box focused, on a wide screen', () => {
  it('nothing steps aside: the panel is a side column there, clear of the button', async () => {
    await inAGroup();
    tab(GROUP_TABS.members);
    const box = screen.getByRole('searchbox', { name: GROUP_TABS.searchMembers });
    box.focus();
    fireEvent.focus(box);
    fireEvent.click(box);
    expect(screen.getByTestId('group-panel-header').className).not.toMatch(/(^| )hidden /);
    expect(screen.queryByTestId('lead-tools')).toBeTruthy();
  });
});

// The geofence ("perimeter breach") banners were removed with the geofence painter (5353d06,
// in every released version since v1.0.0): no app sends 'geofence-alert', so the banners that
// showed one were dead code in the old look. The server still relays the event; the app ignores it.
describe('geofence alerts', () => {
  it('the app no longer listens for them, and one arriving shows nothing', async () => {
    await inAGroup();
    expect(fakeSocket.handlers.has('geofence-alert')).toBe(false);
    act(() => fakeSocket.receive('geofence-alert', { roomCode: code, userName: 'Aarav', zoneName: 'Tech Park', type: 'ENTER' }));
    expect(screen.queryByText(/PERIMETER|BREACH|DEPARTURE/)).toBeNull();
  });
});
