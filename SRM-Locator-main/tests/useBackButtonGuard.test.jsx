// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBackButtonGuard } from '../src/hooks/useBackButtonGuard.js';

const cap = vi.hoisted(() => ({
  isNative: vi.fn(),
  addListener: vi.fn(),
  minimizeApp: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: cap.isNative } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: cap.addListener, minimizeApp: cap.minimizeApp } }));

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

  it('sends the app to the background (not quit) when there is no history', async () => {
    renderHook(() => useBackButtonGuard(false));
    await settle();

    pressBack({ canGoBack: false });
    expect(cap.minimizeApp).toHaveBeenCalledTimes(1);
    expect(historyBack).not.toHaveBeenCalled();
  });
});

describe('useBackButtonGuard as an SOS comes and goes', () => {
  it('follows `blocked` live, with one registration for the whole time', async () => {
    const { rerender } = renderHook(({ blocked }) => useBackButtonGuard(blocked), {
      initialProps: { blocked: false },
    });
    await settle();

    pressBack({ canGoBack: false });
    expect(cap.minimizeApp).toHaveBeenCalledTimes(1); // normal Back

    rerender({ blocked: true }); // SOS arrives
    await settle();
    pressBack({ canGoBack: false });
    pressBack({ canGoBack: true });
    expect(cap.minimizeApp).toHaveBeenCalledTimes(1); // swallowed
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
