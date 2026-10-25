// @vitest-environment jsdom
//
// An SOS heard while LOCUS was closed, from the app's side: the tapped notification arriving as an
// alert, the notification going once the overlay shows it, acknowledging reaching the server, and the
// Settings switch. The native half (listening, the notification, the lock screen) is tested in
// android/app/src/test and by the phone test script; the server's half in tests/sosBackground.integration.test.js.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, render, screen, act, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true },
  registerPlugin: () => ({}),
}));

const { useIncomingSos } = await import('../src/hooks/useIncomingSos.js');
const { useClosedAppSos } = await import('../src/hooks/useClosedAppSos.js');
const { useBackgroundSharing } = await import('../src/hooks/useBackgroundSharing.js');
const { default: BackgroundSharingSection } = await import('../src/components/settings/BackgroundSharingSection.jsx');
const { BACKGROUND_SHARING: COPY } = await import('../src/copy/settings.js');

afterEach(cleanup);

const makeSocket = () => {
  const handlers = {};
  return {
    on: vi.fn((event, fn) => { (handlers[event] ||= new Set()).add(fn); }),
    off: vi.fn((event, fn) => { handlers[event]?.delete(fn); }),
    emit: vi.fn(),
    receive: (event, payload) => handlers[event]?.forEach((fn) => fn(payload)),
  };
};

// The LocusBackground plugin, as far as SOS goes. `fire` is the shell saying the person tapped a notification.
const makePlugin = (over = {}) => {
  const listeners = {};
  return {
    listeners,
    addListener: vi.fn(async (event, fn) => {
      (listeners[event] ||= []).push(fn);
      return { remove: () => { listeners[event] = listeners[event].filter((f) => f !== fn); } };
    }),
    sosShown: vi.fn(async () => {}),
    acknowledgeSos: vi.fn(async () => {}),
    fire: (event, payload) => (listeners[event] ?? []).forEach((fn) => fn(payload)),
    ...over,
  };
};

const tapped = (over = {}) => ({ id: 'sos-9', senderId: 'uA', senderName: 'Asha', lat: 12.8231, lng: 80.0442, ageMs: 4000, timestamp: 1, ...over });

const setup = (plugin = makePlugin()) => {
  const socket = makeSocket();
  const hook = renderHook(() => {
    const incoming = useIncomingSos(socket);
    const acknowledge = useClosedAppSos({ current: incoming.current, pendingCount: incoming.pendingCount, receive: incoming.receive, acknowledge: incoming.acknowledge, plugin });
    return { ...incoming, acknowledge };
  });
  return { socket, plugin, ...hook };
};

describe('a tapped SOS notification', () => {
  it('becomes the alert the overlay shows, with the sender and their last known location', async () => {
    const { result, plugin } = setup();
    await act(async () => {});
    act(() => plugin.fire('sosOpened', tapped()));
    expect(result.current.current).toMatchObject({ id: 'sos-9', senderName: 'Asha', lat: 12.8231, lng: 80.0442, ageMs: 4000 });
    expect(result.current.total).toBe(1);
  });

  it('is held once when the same beacon then arrives over the socket as well', async () => {
    const { result, plugin, socket } = setup();
    await act(async () => {});
    act(() => plugin.fire('sosOpened', tapped()));
    act(() => socket.receive('sos-received', { id: 'sos-9', senderId: 'sock-a', senderName: 'Asha', lat: 12.8231, lng: 80.0442, ageMs: 9000, timestamp: 1 }));
    expect(result.current.total).toBe(1);
    expect(result.current.pendingCount).toBe(0);
  });

  it('queues behind an alert already on screen, like any other', async () => {
    const { result, plugin, socket } = setup();
    await act(async () => {});
    act(() => socket.receive('sos-received', { id: 'live-1', senderId: 'sock-b', senderName: 'Bala', ageMs: 0, timestamp: 1 }));
    act(() => plugin.fire('sosOpened', tapped()));
    expect(result.current.current.id).toBe('live-1');
    expect(result.current.pendingCount).toBe(1);
  });

  it('ignores an event that is not an alert (the same listener hears no other kind)', async () => {
    const { result, plugin } = setup();
    await act(async () => {});
    act(() => plugin.fire('sosOpened', { state: 'stopped', reason: 'user-stop' }));
    act(() => plugin.fire('sosOpened', undefined));
    act(() => plugin.fire('sosOpened', { id: '' }));
    expect(result.current.current).toBeNull();
  });

  it('stops listening when the app goes away', async () => {
    const { plugin, unmount } = setup();
    await act(async () => {});
    expect(plugin.listeners.sosOpened).toHaveLength(1);
    unmount();
    expect(plugin.listeners.sosOpened).toHaveLength(0);
  });
});

describe('the notification and the overlay', () => {
  it('the notification is taken down as soon as the overlay shows that alert, and only then', async () => {
    const { plugin, socket } = setup();
    await act(async () => {});
    expect(plugin.sosShown).not.toHaveBeenCalled();
    act(() => socket.receive('sos-received', { id: 'live-1', senderId: 'sock-b', senderName: 'Bala', ageMs: 0, timestamp: 1 }));
    expect(plugin.sosShown).toHaveBeenCalledTimes(1);
    expect(plugin.sosShown).toHaveBeenCalledWith({ id: 'live-1' });
  });

  it('each alert in a queue is announced as it comes to the front', async () => {
    const { result, plugin, socket } = setup();
    await act(async () => {});
    act(() => socket.receive('sos-received', { id: 'a', senderId: 'x', ageMs: 0, timestamp: 1 }));
    act(() => socket.receive('sos-received', { id: 'b', senderId: 'y', ageMs: 0, timestamp: 1 }));
    expect(plugin.sosShown.mock.calls.map((c) => c[0].id)).toEqual(['a']);
    act(() => result.current.acknowledge());
    expect(plugin.sosShown.mock.calls.map((c) => c[0].id)).toEqual(['a', 'b']);
  });

  it('acknowledging tells the server through the plugin as well as on the socket, then moves on', async () => {
    const { result, plugin, socket } = setup();
    await act(async () => {});
    act(() => plugin.fire('sosOpened', tapped()));
    act(() => result.current.acknowledge());
    expect(socket.emit).toHaveBeenCalledWith('sos-ack', { id: 'sos-9' });
    expect(plugin.acknowledgeSos).toHaveBeenCalledWith({ id: 'sos-9', more: false });
    expect(result.current.current).toBeNull();
  });

  it('says another alert is waiting, so a locked phone is not handed back to its lock screen yet', async () => {
    const { result, plugin, socket } = setup();
    await act(async () => {});
    act(() => socket.receive('sos-received', { id: 'a', senderId: 'x', ageMs: 0, timestamp: 1 }));
    act(() => socket.receive('sos-received', { id: 'b', senderId: 'y', ageMs: 0, timestamp: 1 }));
    act(() => result.current.acknowledge());
    expect(plugin.acknowledgeSos).toHaveBeenLastCalledWith({ id: 'a', more: true });
    act(() => result.current.acknowledge());
    expect(plugin.acknowledgeSos).toHaveBeenLastCalledWith({ id: 'b', more: false });
  });

  it('acknowledging with nothing on screen does nothing', async () => {
    const { result, plugin, socket } = setup();
    await act(async () => {});
    act(() => result.current.acknowledge());
    expect(socket.emit).not.toHaveBeenCalled();
    expect(plugin.acknowledgeSos).not.toHaveBeenCalled();
  });

  it('an older shell without these methods changes nothing and breaks nothing', async () => {
    const plugin = makePlugin({ sosShown: undefined, acknowledgeSos: undefined });
    const { result, socket } = setup(plugin);
    await act(async () => {});
    act(() => socket.receive('sos-received', { id: 'live-1', senderId: 'sock-b', ageMs: 0, timestamp: 1 }));
    expect(() => act(() => result.current.acknowledge())).not.toThrow();
    expect(socket.emit).toHaveBeenCalledWith('sos-ack', { id: 'live-1' });
  });

  it('a plugin that refuses is swallowed, not an unhandled rejection', async () => {
    const plugin = makePlugin({ sosShown: vi.fn(() => Promise.reject(new Error('nope'))), acknowledgeSos: vi.fn(() => { throw new Error('sync'); }) });
    const { result, socket } = setup(plugin);
    await act(async () => {});
    act(() => socket.receive('sos-received', { id: 'live-1', senderId: 'sock-b', ageMs: 0, timestamp: 1 }));
    await act(async () => {});
    expect(() => act(() => result.current.acknowledge())).not.toThrow();
  });
});

// ---- Settings ----

const capabilities = (over = {}) => ({
  version: 1, running: false, notificationsEnabled: true, locationGranted: true, resumable: false,
  sosAlerts: true, sosAlertsOn: true, sosAudible: true, sosFullScreen: true, ...over,
});

const bgHook = async (plugin, extra = {}) => {
  const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ available: true }) }));
  const hook = renderHook(() => useBackgroundSharing({
    inGroup: false, roomCode: '', groupName: '', polling: 'balanced', backendUrl: 'https://server.example',
    getIdToken: async () => 'id', plugin, fetchImpl, ...extra,
  }));
  await act(async () => {});
  return hook;
};

const settingsPlugin = (caps = capabilities()) => ({
  getCapabilities: vi.fn(async () => caps),
  getState: vi.fn(async () => ({ running: false, state: 'stopped' })),
  addListener: vi.fn(async () => ({ remove: () => {} })),
  setSosAlerts: vi.fn(async () => {}),
});

describe('the SOS alerts setting', () => {
  it('is there, on, when the shell can do it', async () => {
    const { result } = await bgHook(settingsPlugin());
    expect(result.current.sosAlerts).toMatchObject({ on: true, audible: true, fullScreen: true });
  });

  it('is not there for a shell that predates it', async () => {
    const { result } = await bgHook(settingsPlugin(capabilities({ sosAlerts: undefined })));
    expect(result.current.sosAlerts).toBeNull();
  });

  it('shows the person\'s earlier choice, and what the phone allows', async () => {
    const { result } = await bgHook(settingsPlugin(capabilities({ sosAlertsOn: false, sosAudible: false, sosFullScreen: false })));
    expect(result.current.sosAlerts).toMatchObject({ on: false, audible: false, fullScreen: false });
  });

  it('turning it off tells the shell, and the choice shows at once', async () => {
    const plugin = settingsPlugin();
    const { result } = await bgHook(plugin);
    act(() => result.current.sosAlerts.setOn(false));
    expect(plugin.setSosAlerts).toHaveBeenCalledWith({ enabled: false });
    expect(result.current.sosAlerts.on).toBe(false);
    act(() => result.current.sosAlerts.setOn(true));
    expect(plugin.setSosAlerts).toHaveBeenLastCalledWith({ enabled: true });
    expect(result.current.sosAlerts.on).toBe(true);
  });

  it('shows what is true if the shell would not take the change', async () => {
    const plugin = settingsPlugin();
    plugin.setSosAlerts = vi.fn(() => Promise.reject(new Error('no')));
    const { result } = await bgHook(plugin);
    await act(async () => { result.current.sosAlerts.setOn(false); });
    expect(result.current.sosAlerts.on).toBe(true);
  });

  it('asks the phone again when Settings is opened (its own notification settings may have changed)', async () => {
    const caps = { value: capabilities() };
    const plugin = settingsPlugin();
    plugin.getCapabilities = vi.fn(async () => caps.value);
    const { result } = await bgHook(plugin);
    expect(result.current.sosAlerts.audible).toBe(true);
    caps.value = capabilities({ sosAudible: false });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.sosAlerts.audible).toBe(false);
  });
});

const section = (sosAlerts, { on = true } = {}) => render(
  <BackgroundSharingSection
    group="ABC123"
    layer={10}
    backgroundSharing={{
      available: true, on, status: { state: on ? 'running' : 'off' }, consentOpen: false, requestChange: vi.fn(),
      acceptConsent: vi.fn(), declineConsent: vi.fn(), refresh: vi.fn(), sosAlerts,
    }}
  />,
);

describe('the SOS alerts row in Settings', () => {
  const prefs = (over = {}) => ({ on: true, audible: true, fullScreen: true, setOn: vi.fn(), ...over });

  it('says what it does in plain words, and that it needs sharing', () => {
    section(prefs());
    const row = screen.getByTestId('sos-alerts');
    expect(row.textContent).toContain(COPY.sos.label);
    expect(row.textContent).toContain("If a teammate sends an SOS, you'll be alerted even if you've closed the app.");
    expect(screen.getByTestId('sos-alerts-note').textContent).toBe(COPY.sos.needsSharing);
    expect(COPY.sos.needsSharing).toContain('stop too');
  });

  it('is a switch that follows the choice, and tapping it asks to change it', () => {
    const p = prefs();
    section(p);
    const sw = screen.getByRole('switch', { name: new RegExp(COPY.sos.label) });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(p.setOn).toHaveBeenCalledWith(false);
  });

  it('reads as off and does nothing while Keep sharing is off, because the alerts stop with it', () => {
    const p = prefs();
    section(p, { on: false });
    const sw = screen.getByRole('switch', { name: new RegExp(COPY.sos.label) });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(p.setOn).not.toHaveBeenCalled();
    // UI audit A7c: greyed out, with the reason in one line in the row itself.
    expect(screen.getByTestId('sos-alerts').textContent).toContain(COPY.sos.offReason);
    expect(screen.getByTestId('sos-alerts').dataset.unavailable).toBe('true');
  });

  it('says so when the phone has these alerts turned off, or will not let them take over the screen', () => {
    section(prefs({ audible: false, fullScreen: false }));
    expect(screen.getByTestId('sos-alerts-silenced').textContent).toBe(COPY.sos.notAudible);
    expect(screen.getByTestId('sos-alerts-no-fullscreen').textContent).toBe(COPY.sos.noFullScreen);
  });

  it('says nothing about that when all is well, or when the person has turned the alerts off themselves', () => {
    section(prefs());
    expect(screen.queryByTestId('sos-alerts-silenced')).toBeNull();
    expect(screen.queryByTestId('sos-alerts-no-fullscreen')).toBeNull();
    cleanup();
    section(prefs({ on: false, audible: false, fullScreen: false }));
    expect(screen.queryByTestId('sos-alerts-silenced')).toBeNull();
  });

  it('is not there at all for a shell that cannot do it', () => {
    section(null);
    expect(screen.queryByTestId('sos-alerts')).toBeNull();
    expect(screen.queryByTestId('sos-alerts-note')).toBeNull();
    expect(screen.getByTestId('background-sharing')).toBeTruthy();
  });
});
