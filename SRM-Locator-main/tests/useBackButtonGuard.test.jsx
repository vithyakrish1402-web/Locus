// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBackButtonGuard, BACK_EXIT_WINDOW_MS } from '../src/hooks/useBackButtonGuard.js';
import { pushBackHandler } from '../src/utils/backHandlers.js';

const cap = vi.hoisted(() => ({
  isNative: vi.fn(),
  addListener: vi.fn(),
  minimizeApp: vi.fn(),
  exitApp: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: cap.isNative } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: cap.addListener, minimizeApp: cap.minimizeApp, exitApp: cap.exitApp } }));
vi.mock('../src/utils/notify', () => ({ notify: { info: cap.info } }));

let pressBack; // invokes the backButton listener the hook registered, like Android would
let remove;
let historyBack;

beforeEach(() => {
  cap.isNative.mockReturnValue(true);
  remove = vi.fn();
  pressBack = undefined;
  cap.addListener.mockImplementation((event, callback) => {
    expect(event).toBe('backButton');
    pressBack = callback;
    return Promise.resolve({ remove });
  });
  cap.minimizeApp.mockClear();
  cap.exitApp.mockClear();
  cap.info.mockClear();
  historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  historyBack.mockRestore();
});

// Let the mocked addListener() promise resolve so the hook holds its handle.
const settle = () => act(async () => {});

describe('useBackButtonGuard on the web', () => {
  it('registers nothing — there is no hardware Back button to guard', async () => {
    cap.isNative.mockReturnValue(false);
    renderHook(() => useBackButtonGuard(true));
    await settle();
    expect(cap.addListener).not.toHaveBeenCalled();
  });
});

describe('useBackButtonGuard while an SOS is up (blocked)', () => {
  it('swallows Back completely: no history step, no backgrounding', async () => {
    renderHook(() => useBackButtonGuard(true));
    await settle();

    pressBack({ canGoBack: true });
    pressBack({ canGoBack: false });
    expect(historyBack).not.toHaveBeenCalled();
    expect(cap.minimizeApp).not.toHaveBeenCalled();
    expect(cap.exitApp).not.toHaveBeenCalled();
    expect(cap.info).not.toHaveBeenCalled();
  });
});

describe('useBackButtonGuard normally (not blocked)', () => {
  it('steps back through WebView history when there is some', async () => {
    renderHook(() => useBackButtonGuard(false));
    await settle();

    pressBack({ canGoBack: true });
    expect(historyBack).toHaveBeenCalledTimes(1);
    expect(cap.minimizeApp).not.toHaveBeenCalled();
  });

  it('on the home screen, says "press again" first, and leaves on a second press inside the window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    renderHook(() => useBackButtonGuard(false));
    await settle();

    pressBack({ canGoBack: false });
    expect(cap.exitApp).not.toHaveBeenCalled();
    expect(cap.minimizeApp).not.toHaveBeenCalled();
    expect(cap.info).toHaveBeenCalledTimes(1);
    expect(cap.info.mock.calls[0][0]).toBe('Press back again to exit');
    expect(cap.info.mock.calls[0][1]).toMatchObject({ duration: BACK_EXIT_WINDOW_MS, haptic: false });

    now.mockReturnValue(1_000_000 + BACK_EXIT_WINDOW_MS - 1);
    pressBack({ canGoBack: false });
    expect(cap.exitApp).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('does not leave on a second press after the window: that press asks again', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    renderHook(() => useBackButtonGuard(false));
    await settle();
    pressBack({ canGoBack: false });
    now.mockReturnValue(1_000_000 + BACK_EXIT_WINDOW_MS);
    pressBack({ canGoBack: false });
    expect(cap.exitApp).not.toHaveBeenCalled();
    expect(cap.info).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('starts the count afresh when a press in between closed something', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    let open = false;
    const off = pushBackHandler(() => (open ? (open = false, true) : false));
    renderHook(() => useBackButtonGuard(false));
    await settle();
    pressBack({ canGoBack: false }); // "press again"
    open = true;
    pressBack({ canGoBack: false }); // closes the overlay
    pressBack({ canGoBack: false }); // home again: asks again, does not leave
    expect(cap.exitApp).not.toHaveBeenCalled();
    expect(cap.info).toHaveBeenCalledTimes(2);
    off();
    now.mockRestore();
  });
});

describe('useBackButtonGuard with a surface that wants Back (AR Scan)', () => {
  it('lets the newest handler take the press, and does nothing else with it', async () => {
    const handler = vi.fn(() => true);
    const off = pushBackHandler(handler);
    renderHook(() => useBackButtonGuard(false));
    await settle();

    pressBack({ canGoBack: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(historyBack).not.toHaveBeenCalled();
    expect(cap.minimizeApp).not.toHaveBeenCalled();

    off(); // the surface closed: Back is the app's again
    pressBack({ canGoBack: false });
    expect(cap.info).toHaveBeenCalledTimes(1);
    expect(cap.exitApp).not.toHaveBeenCalled();
  });

  it('still swallows Back during an SOS, whatever handler is registered', async () => {
    const handler = vi.fn(() => true);
    const off = pushBackHandler(handler);
    renderHook(() => useBackButtonGuard(true));
    await settle();
    pressBack({ canGoBack: false });
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});

describe('useBackButtonGuard as an SOS comes and goes', () => {
  it('follows `blocked` live, with one registration for the whole time', async () => {
    const { rerender } = renderHook(({ blocked }) => useBackButtonGuard(blocked), {
      initialProps: { blocked: false },
    });
    await settle();

    pressBack({ canGoBack: false });
    expect(cap.info).toHaveBeenCalledTimes(1); // normal Back: "press again to exit"

    rerender({ blocked: true }); // SOS arrives
    await settle();
    pressBack({ canGoBack: false });
    pressBack({ canGoBack: true });
    expect(cap.info).toHaveBeenCalledTimes(1); // swallowed
    expect(cap.exitApp).not.toHaveBeenCalled();
    expect(historyBack).not.toHaveBeenCalled();

    rerender({ blocked: false }); // acknowledged
    await settle();
    pressBack({ canGoBack: true });
    expect(historyBack).toHaveBeenCalledTimes(1); // normal again

    expect(cap.addListener).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('useBackButtonGuard cleanup', () => {
  it('removes the listener on unmount', async () => {
    const { unmount } = renderHook(() => useBackButtonGuard(false));
    await settle();
    unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('removes it even if unmounted before the plugin finished registering', async () => {
    let finishRegistering;
    cap.addListener.mockImplementation(
      () => new Promise((resolve) => { finishRegistering = () => resolve({ remove }); })
    );
    const { unmount } = renderHook(() => useBackButtonGuard(false));
    unmount();
    expect(remove).not.toHaveBeenCalled(); // nothing to remove yet

    await act(async () => finishRegistering());
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
