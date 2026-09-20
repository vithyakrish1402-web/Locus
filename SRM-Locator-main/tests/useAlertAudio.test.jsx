// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import process from 'node:process';
import { StrictMode } from 'react';
import { renderHook, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useAlertAudio } from '../src/hooks/useAlertAudio.js';
import SosOverlay from '../src/components/SosOverlay.jsx';

// A stand-in AudioContext that records what the klaxon does to it, so we can assert on
// the tone pattern and — importantly — that nothing is left running afterwards.
const created = [];
let initialState = 'running';
let resumeImpl = null;

class FakeOscillator {
  constructor() {
    this.type = '';
    this.frequencyHistory = [];
    this.frequency = { setValueAtTime: vi.fn((hz) => this.frequencyHistory.push(hz)) };
    this.start = vi.fn();
    this.stop = vi.fn();
    this.connect = vi.fn();
    this.disconnect = vi.fn();
  }
}

class FakeAudioContext {
  constructor() {
    this.state = initialState;
    this.currentTime = 0;
    this.destination = {};
    this.resume = vi.fn(resumeImpl ?? (() => { this.state = 'running'; return Promise.resolve(); }));
    this.close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
    created.push(this);
  }

  createOscillator() {
    this.oscillator = new FakeOscillator();
    return this.oscillator;
  }

  createGain() {
    this.gainNode = { gain: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    return this.gainNode;
  }
}

const liveContexts = () => created.filter((ctx) => ctx.state !== 'closed');

beforeEach(() => {
  created.length = 0;
  initialState = 'running';
  resumeImpl = null;
  window.AudioContext = FakeAudioContext;
  navigator.vibrate = vi.fn();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.AudioContext;
  delete window.webkitAudioContext;
});

describe('useAlertAudio klaxon', () => {
  it('runs one persistent sawtooth oscillator starting on the low tone', () => {
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();

    expect(created).toHaveLength(1);
    const { oscillator } = created[0];
    expect(oscillator.type).toBe('sawtooth');
    expect(oscillator.start).toHaveBeenCalledTimes(1);
    expect(oscillator.frequencyHistory).toEqual([440]);
  });

  it('alternates 440/880Hz every 500ms, on the same oscillator', () => {
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();
    const { oscillator } = created[0];

    vi.advanceTimersByTime(499);
    expect(oscillator.frequencyHistory).toEqual([440]); // not yet
    vi.advanceTimersByTime(1);
    expect(oscillator.frequencyHistory).toEqual([440, 880]);
    vi.advanceTimersByTime(500);
    expect(oscillator.frequencyHistory).toEqual([440, 880, 440]);
    vi.advanceTimersByTime(1000);
    expect(oscillator.frequencyHistory).toEqual([440, 880, 440, 880, 440]);

    expect(created).toHaveLength(1);
    expect(oscillator.start).toHaveBeenCalledTimes(1); // stepped, never restarted (no clicks)
  });

  it('is idempotent: starting twice does not stack a second klaxon', () => {
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();
    result.current.start();
    expect(created).toHaveLength(1);
  });
});

describe('useAlertAudio teardown', () => {
  it('stop() silences everything: interval, oscillator, gain and the context itself', () => {
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();
    const ctx = created[0];

    result.current.stop();
    expect(ctx.oscillator.stop).toHaveBeenCalledTimes(1);
    expect(ctx.oscillator.disconnect).toHaveBeenCalled();
    expect(ctx.gainNode.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalledTimes(1);

    const stepsAtStop = ctx.oscillator.frequencyHistory.length;
    vi.advanceTimersByTime(5000);
    expect(ctx.oscillator.frequencyHistory).toHaveLength(stepsAtStop); // interval really cleared
    expect(liveContexts()).toHaveLength(0);
  });

  it('stop() is safe to call again, or before start()', () => {
    const { result } = renderHook(() => useAlertAudio());
    expect(() => result.current.stop()).not.toThrow();
    result.current.start();
    result.current.stop();
    expect(() => result.current.stop()).not.toThrow();
    expect(created[0].close).toHaveBeenCalledTimes(1);
  });

  it('can be started again after a stop, on a fresh context', () => {
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();
    result.current.stop();
    result.current.start();
    expect(created).toHaveLength(2);
    expect(liveContexts()).toHaveLength(1);
  });

  it('stops the klaxon if the component simply unmounts', () => {
    const { result, unmount } = renderHook(() => useAlertAudio());
    result.current.start();
    unmount();
    expect(liveContexts()).toHaveLength(0);
    expect(created[0].oscillator.stop).toHaveBeenCalled();
  });

  it('survives an oscillator that has already been stopped', () => {
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();
    created[0].oscillator.stop.mockImplementation(() => { throw new Error('InvalidStateError'); });
    expect(() => result.current.stop()).not.toThrow();
    expect(created[0].close).toHaveBeenCalled();
  });
});

describe('useAlertAudio autoplay policy', () => {
  it('resumes a context that comes up suspended, so the klaxon is actually audible', () => {
    initialState = 'suspended';
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();
    expect(created[0].resume).toHaveBeenCalledTimes(1);
    expect(created[0].state).toBe('running');
  });

  it('leaves an already-running context alone', () => {
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();
    expect(created[0].resume).not.toHaveBeenCalled();
  });

  it('shrugs off a resume the browser refuses, without an unhandled rejection', async () => {
    initialState = 'suspended';
    resumeImpl = () => Promise.reject(new Error('NotAllowedError'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const { result } = renderHook(() => useAlertAudio());
    expect(() => result.current.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(10);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('does nothing, quietly, where Web Audio does not exist', () => {
    delete window.AudioContext;
    const { result } = renderHook(() => useAlertAudio());
    expect(() => result.current.start()).not.toThrow();
    expect(created).toHaveLength(0);
  });

  it('falls back to the prefixed webkitAudioContext', () => {
    delete window.AudioContext;
    window.webkitAudioContext = FakeAudioContext;
    const { result } = renderHook(() => useAlertAudio());
    result.current.start();
    expect(created).toHaveLength(1);
  });
});

describe('SosOverlay + real klaxon under <StrictMode> (the dev-mode silent-klaxon regression)', () => {
  it('ends up with exactly one klaxon running, not zero', () => {
    render(
      <StrictMode>
        <SosOverlay senderName="Bravo" lat={1} lng={2} onAcknowledge={() => {}} />
      </StrictMode>
    );
    // StrictMode mounts, cleans up and mounts again. The first context is closed by
    // that cleanup; the second must be left running with its oscillator started.
    const live = liveContexts();
    expect(live).toHaveLength(1);
    expect(live[0].oscillator.start).toHaveBeenCalledTimes(1);
  });

  it('is fully silent, with nothing orphaned, after ACKNOWLEDGE', () => {
    render(
      <StrictMode>
        <SosOverlay senderName="Bravo" lat={1} lng={2} onAcknowledge={() => {}} />
      </StrictMode>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(liveContexts()).toHaveLength(0);
    created.forEach((ctx) => expect(ctx.close).toHaveBeenCalled());
  });
});
