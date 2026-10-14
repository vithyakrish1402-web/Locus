// @vitest-environment jsdom
//
// The Emergency button's look and words: the pill from the design build (js-1.1.32), with its
// behaviour pinned as it was: the same hit area in every state, the bars and the card taking
// no touches, "Hold longer" behaving exactly like resting, a screen reader told each change,
// and reduced motion stopping the bounce and the pulse but never the bars.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import SosTrigger from '../src/components/SosTrigger.jsx';
import { SOS_HOLD, SOS_SPOKEN, SOS_BUTTON } from '../src/copy/emergency.js';

const HOLD = 1200;
const WINDOW = 4000;
let socket;

const renderButton = (props = {}) => {
  socket = { emit: vi.fn() };
  render(<SosTrigger socket={socket} getLocation={() => ({ lat: 12.82, lng: 80.04 })} roomCode="K7M2QX" senderName="Meera" {...props} />);
  return screen.getByTestId('sos-button');
};
const press = (b) => fireEvent.pointerDown(b, { button: 0 });
const release = (b) => fireEvent.pointerUp(b);
const wait = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const sent = () => socket.emit.mock.calls.filter(([e]) => e === 'sos-broadcast');
const spoken = () => screen.getByTestId('sos-spoken').textContent;
const card = () => screen.queryByTestId('sos-hold-card');

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Each state the button can be in, reached by the real gesture.
const STATES = {
  idle: () => {},
  arming: (b) => { press(b); wait(HOLD / 2); },
  armed: (b) => { press(b); wait(HOLD); release(b); },
  confirming: (b) => { press(b); wait(HOLD); release(b); press(b); wait(HOLD / 2); },
  fired: (b) => { press(b); wait(HOLD); release(b); press(b); wait(HOLD); release(b); },
  early: (b) => { press(b); wait(HOLD / 2); release(b); },
};

describe('the hit area', () => {
  // The pill from the design build (js-1.1.32): in the phone's tab bar, or floating over a
  // screen. Its size never changes with its state, so a finger mid-hold never slips off it.
  it.each(Object.keys(STATES))('%s: the same pill in the tab bar, whatever its state', (state) => {
    const b = renderButton({ layout: 'tab' });
    STATES[state](b);
    expect(b.className).toMatch(/(^| )h-11( |$)/);
    expect(b.className).toMatch(/(^| )px-3\.5( |$)/);
  });

  it.each(Object.keys(STATES))('%s: the same pill floating, whatever its state', (state) => {
    const b = renderButton({ layout: 'floating' });
    STATES[state](b);
    expect(b.className).toMatch(/(^| )h-12( |$)/);
    expect(b.className).toMatch(/(^| )px-6( |$)/);
  });

  it('the progress bars, the card and the dimmed screen take no touches', () => {
    const b = renderButton();
    press(b);
    wait(HOLD / 2);
    expect(screen.getByTestId('sos-fill').className).toContain('pointer-events-none');
    wait(HOLD / 2);
    release(b);
    expect(screen.getByTestId('sos-countdown').className).toContain('pointer-events-none');
    expect(card().className).toContain('pointer-events-none');
    expect(screen.getByTestId('sos-scrim').className).toContain('pointer-events-none');
    expect(card().getAttribute('aria-hidden')).toBe('true');
  });

  // Which bar shows in each state: the hold fill while holding, the countdown while armed.
  it.each([
    ['idle', { fill: false, countdown: false }],
    ['arming', { fill: true, countdown: false }],
    ['armed', { fill: false, countdown: true }],
    ['confirming', { fill: true, countdown: false }],
    ['fired', { fill: false, countdown: false }],
  ])('%s: only its own bar shows', (state, shown) => {
    const b = renderButton();
    STATES[state](b);
    expect(Boolean(screen.queryByTestId('sos-fill'))).toBe(shown.fill);
    expect(Boolean(screen.queryByTestId('sos-countdown'))).toBe(shown.countdown);
  });

  it('nothing but the button starts a hold: a press on the card or the dimmed screen does nothing', () => {
    const b = renderButton();
    STATES.armed(b);
    press(card());
    press(screen.getByTestId('sos-scrim'));
    wait(HOLD);
    expect(sent()).toHaveLength(0);
    expect(b.dataset.phase).toBe('armed');
  });
});

describe('"Hold longer" behaves exactly like resting', () => {
  it('shows after letting go early in either hold, for 1.5 s, then SOS again', () => {
    let b = renderButton();
    STATES.early(b);
    expect(b.dataset.view).toBe('early');
    expect(b.textContent).toBe(SOS_BUTTON.early);
    wait(1499);
    expect(b.dataset.view).toBe('early');
    wait(1);
    expect(b.dataset.view).toBe('idle');
    cleanup();

    b = renderButton();
    STATES.armed(b);
    press(b);
    wait(HOLD - 100);
    release(b);
    expect(b.dataset.view).toBe('early');
    expect(b.dataset.phase).toBe('idle'); // back to the very start, not armed
  });

  it('is resting: the same phase, the same label for a screen reader, and a press arms on the same timing', () => {
    const b = renderButton();
    STATES.early(b);
    expect(b.dataset.phase).toBe('idle');
    expect(b.getAttribute('aria-label')).toBe('Press and hold to arm SOS beacon');
    press(b);
    expect(b.dataset.view).toBe('arming');
    wait(HOLD - 1);
    expect(b.dataset.phase).toBe('arming');
    wait(1);
    expect(b.dataset.phase).toBe('armed');
    release(b);
    press(b);
    wait(HOLD);
    expect(sent()).toHaveLength(1);
  });

  it('a short press during "Hold longer" arms nothing, as at rest', () => {
    const b = renderButton();
    STATES.early(b);
    press(b);
    wait(HOLD - 100);
    release(b);
    wait(WINDOW);
    expect(b.dataset.phase).toBe('idle');
    expect(sent()).toHaveLength(0);
  });
});

describe('the card above the button', () => {
  it('says what is happening in each hold, and nothing at rest', () => {
    const b = renderButton();
    expect(card()).toBeNull();
    press(b);
    expect(card().textContent).toContain(SOS_HOLD.arming.title);
    expect(card().textContent).toContain(SOS_HOLD.arming.body);
    wait(HOLD);
    release(b);
    expect(card().textContent).toContain(SOS_HOLD.armed.title);
    expect(card().textContent).toContain(SOS_HOLD.armed.body);
    press(b);
    expect(card().textContent).toContain(SOS_HOLD.confirming.title);
    wait(HOLD);
    expect(card()).toBeNull();
  });

  it('the two steps: the first done from the first hold, the second during the second hold', () => {
    const b = renderButton();
    press(b);
    let steps = screen.getAllByTestId('sos-step');
    expect(steps.map((s) => Boolean(s.dataset.done))).toEqual([true, false]);
    wait(HOLD);
    release(b);
    press(b);
    steps = screen.getAllByTestId('sos-step');
    expect(steps.map((s) => Boolean(s.dataset.done))).toEqual([true, true]);
  });

  it.each([['ACTIVE', false], ['FROZEN', true], ['GHOST', true]])('sharing %s: says the location goes with it: %s', (mode, shown) => {
    const b = renderButton({ sharingMode: mode });
    STATES.armed(b);
    expect(Boolean(screen.queryByTestId('sos-location-note'))).toBe(shown);
    press(b);
    expect(Boolean(screen.queryByTestId('sos-location-note'))).toBe(shown);
  });
});

describe('the look', () => {
  it('tinted red at rest, solid red while held, white once armed, green with a tick once sent', () => {
    const b = renderButton();
    expect(b.className).toContain('bg-danger/15');
    expect(b.className).toContain('text-danger');
    expect(b.textContent).toBe('SOS');
    press(b);
    expect(b.className).toMatch(/(^| )bg-danger( |$)/);
    wait(HOLD);
    release(b);
    expect(b.className).toMatch(/(^| )bg-white( |$)/);
    press(b);
    wait(HOLD);
    expect(b.className).toMatch(/(^| )bg-success( |$)/);
    expect(b.querySelector('svg.lucide-check')).toBeTruthy();
  });
});

describe('screen readers', () => {
  it('are told each change, politely', () => {
    const b = renderButton();
    expect(screen.getByTestId('sos-spoken').getAttribute('aria-live')).toBe('polite');
    expect(spoken()).toBe('');
    press(b);
    expect(spoken()).toBe(SOS_SPOKEN.arming);
    wait(HOLD);
    release(b);
    expect(spoken()).toBe(SOS_SPOKEN.armed);
    expect(spoken()).toBe('Armed. Hold again within 4 seconds to send an emergency alert.');
    press(b);
    expect(spoken()).toBe(SOS_SPOKEN.confirming);
    wait(HOLD);
    expect(spoken()).toBe(SOS_SPOKEN.fired);
  });

  it('hear "Hold longer" after letting go early, and "Waiting for connection" while held', () => {
    let b = renderButton();
    STATES.early(b);
    expect(spoken()).toBe(SOS_SPOKEN.early);
    cleanup();
    b = renderButton({ held: true });
    expect(spoken()).toBe(SOS_SPOKEN.held);
    expect(b.textContent).toBe(SOS_BUTTON.held);
  });
});

describe('reduced motion', () => {
  it("stops the armed icon bouncing and the card's dot pulsing", () => {
    const b = renderButton();
    STATES.armed(b);
    const icon = b.querySelector('svg.lucide-triangle-alert');
    expect(icon.getAttribute('class')).toContain('animate-bounce');
    expect(icon.getAttribute('class')).toContain('motion-reduce:animate-none');
    expect(card().querySelector('.animate-ping').className).toContain('motion-reduce:animate-none');
  });

  it('the bars still fill and drain: their width follows the hold, whatever the motion setting', () => {
    const b = renderButton();
    press(b);
    wait(HOLD / 2);
    expect(parseFloat(screen.getByTestId('sos-fill').style.width)).toBeGreaterThan(0);
    wait(HOLD / 2);
    release(b);
    wait(WINDOW / 2);
    const left = parseFloat(screen.getByTestId('sos-countdown').style.width);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(100);
  });
});
