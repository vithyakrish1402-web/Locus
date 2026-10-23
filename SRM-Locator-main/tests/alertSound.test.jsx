// @vitest-environment jsdom
//
// Item 8 of the 2026-10 bug batch: alert sounds at full volume. On a phone the SOS klaxon and the
// ping play natively, on the alarm stream (android/.../AlertSoundPlugin.java); without the plugin
// (the web, an older shell) the Web Audio sound plays as before. LOCUS's own Do Not Disturb is
// kept on the phone and handed to native code.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

const cap = vi.hoisted(() => ({
  native: true,
  available: true,
  plugin: {
    play: vi.fn(),
    stop: vi.fn(() => Promise.resolve()),
    setInAppDnd: vi.fn(() => Promise.resolve()),
    getDndAccess: vi.fn(),
    openDndAccessSettings: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => cap.native, isPluginAvailable: (name) => cap.available && name === 'AlertSound' },
  registerPlugin: () => cap.plugin,
}));

const sound = await import('../src/utils/alertSound.js');
const { useAlertAudio } = await import('../src/hooks/useAlertAudio.js');
const dnd = await import('../src/utils/inAppDnd.js');

// A Web Audio stand-in that records whether a klaxon was started.
let contexts;
class FakeAudioContext {
  constructor() { contexts.push(this); this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  createOscillator() { return { type: '', frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {} }, connect() {}, disconnect() {} }; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

beforeEach(() => {
  cap.native = true;
  cap.available = true;
  Object.values(cap.plugin).forEach((fn) => fn.mockClear());
  cap.plugin.play.mockImplementation(() => Promise.resolve({ playing: true }));
  contexts = [];
  window.AudioContext = FakeAudioContext;
  localStorage.clear();
  dnd.__resetInAppDnd();
});
afterEach(() => {
  cleanup();
  delete window.AudioContext;
});

describe('the native bridge', () => {
  it('plays at the full alarm volume fraction', async () => {
    expect(sound.ALERT_ALARM_VOLUME_FRACTION).toBe(1.0);
    expect(await sound.playAlertSound('ping')).toBe(true);
    expect(cap.plugin.play).toHaveBeenCalledWith({ kind: 'ping', volumeFraction: 1.0 });
  });

  it('says it did not play when the plugin is missing or refuses', async () => {
    cap.available = false;
    expect(await sound.playAlertSound('sos')).toBe(false);
    expect(cap.plugin.play).not.toHaveBeenCalled();
    cap.available = true;
    cap.plugin.play.mockImplementation(() => Promise.reject(new Error('no audio')));
    expect(await sound.playAlertSound('sos')).toBe(false);
    cap.native = false;
    expect(await sound.dndAccessGranted()).toBeNull();
  });

  it('reports Do Not Disturb access, and opens its settings screen', async () => {
    cap.plugin.getDndAccess.mockResolvedValue({ granted: false });
    expect(await sound.dndAccessGranted()).toBe(false);
    expect(await sound.openDndAccessSettings()).toBe(true);
    expect(cap.plugin.openDndAccessSettings).toHaveBeenCalledTimes(1);
  });
});

describe('the SOS klaxon (useAlertAudio)', () => {
  it('plays natively on a phone, and not through Web Audio', async () => {
    const { result } = renderHook(() => useAlertAudio());
    await act(async () => { result.current.start(); });
    expect(cap.plugin.play).toHaveBeenCalledWith({ kind: 'sos', volumeFraction: 1.0 });
    expect(contexts).toHaveLength(0);
    act(() => result.current.stop());
    expect(cap.plugin.stop).toHaveBeenCalledTimes(1);
  });

  it('falls back to Web Audio when the native klaxon cannot play', async () => {
    cap.plugin.play.mockImplementation(() => Promise.resolve({ playing: false }));
    const { result } = renderHook(() => useAlertAudio());
    await act(async () => { result.current.start(); });
    expect(contexts).toHaveLength(1);
  });

  it('is Web Audio where there is no native plugin, as before', async () => {
    cap.available = false;
    const { result } = renderHook(() => useAlertAudio());
    await act(async () => { result.current.start(); });
    expect(contexts).toHaveLength(1);
    expect(cap.plugin.play).not.toHaveBeenCalled();
  });

  it('starts once however often it is asked, and stops the native one on unmount', async () => {
    const { result, unmount } = renderHook(() => useAlertAudio());
    await act(async () => { result.current.start(); result.current.start(); });
    expect(cap.plugin.play).toHaveBeenCalledTimes(1);
    unmount();
    expect(cap.plugin.stop).toHaveBeenCalledTimes(1);
  });
});

describe("LOCUS's own Do Not Disturb", () => {
  it('is off to start with, kept on the phone, and handed to native code', () => {
    expect(dnd.isInAppDnd()).toBe(false);
    dnd.setInAppDnd(true);
    expect(dnd.isInAppDnd()).toBe(true);
    expect(localStorage.getItem(dnd.IN_APP_DND_KEY)).toBe('1');
    expect(cap.plugin.setInAppDnd).toHaveBeenCalledWith({ on: true });
    dnd.setInAppDnd(false);
    expect(localStorage.getItem(dnd.IN_APP_DND_KEY)).toBeNull();
    expect(cap.plugin.setInAppDnd).toHaveBeenLastCalledWith({ on: false });
  });
});
