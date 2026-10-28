// @vitest-environment jsdom
//
// The Emergency button's two-hold rule (SosTrigger.jsx), unchanged by standing above AR Scan:
// press and hold to arm, then a second press and hold within the arm window to send. Nothing
// is sent before the second hold completes, and the layer it stands on changes nothing else.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import SosTrigger from '../src/components/SosTrigger.jsx';
import { LAYER } from '../src/utils/layers.js';
import { createSosOutbox } from '../src/utils/sosOutbox.js';

const HOLD = 1200;
const WINDOW = 4000;
let socket;

const renderButton = (props = {}) => {
  socket = { emit: vi.fn() };
  render(<SosTrigger socket={socket} getLocation={() => ({ lat: 12.82, lng: 80.04 })} roomCode="K7M2QX" senderName="Meera" {...props} />);
  return screen.getByRole('button');
};
const press = (button) => fireEvent.pointerDown(button, { button: 0 });
const release = (button) => fireEvent.pointerUp(button);
const wait = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const sent = () => socket.emit.mock.calls.filter(([e]) => e === 'sos-broadcast');

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe.each([
  ['on its one layer', {}],
])('the two holds, %s', (_label, props) => {
  it('hold, let go, hold again: sent once, only after the second hold', () => {
    const button = renderButton(props);
    press(button);
    wait(HOLD);
    release(button);
    expect(button.getAttribute('aria-label')).toMatch(/^Armed/);
    expect(sent()).toHaveLength(0);
    press(button);
    wait(HOLD - 1);
    expect(sent()).toHaveLength(0);
    wait(1);
    expect(sent()).toHaveLength(1);
    expect(sent()[0][1]).toMatchObject({ lat: 12.82, lng: 80.04, roomCode: 'K7M2QX', senderName: 'Meera' });
  });

  it('a short press arms nothing', () => {
    const button = renderButton(props);
    press(button);
    wait(HOLD - 100);
    release(button);
    wait(WINDOW);
    expect(button.getAttribute('aria-label')).toMatch(/^Press and hold to arm/);
    expect(sent()).toHaveLength(0);
  });

  it('no second hold within the window: back to the start, nothing sent', () => {
    const button = renderButton(props);
    press(button);
    wait(HOLD);
    release(button);
    wait(WINDOW);
    expect(button.getAttribute('aria-label')).toMatch(/^Press and hold to arm/);
    press(button);
    wait(HOLD);
    release(button);
    expect(sent()).toHaveLength(0);
  });

  it('sliding off the button during either hold cancels it', () => {
    const button = renderButton(props);
    press(button);
    wait(HOLD - 100);
    fireEvent.pointerLeave(button);
    wait(HOLD);
    expect(button.getAttribute('aria-label')).toMatch(/^Press and hold to arm/);
    press(button);
    wait(HOLD);
    release(button);
    press(button);
    wait(HOLD - 100);
    fireEvent.pointerLeave(button);
    wait(HOLD);
    expect(sent()).toHaveLength(0);
  });

  it('a touch the phone cancels (a scroll, a call) cancels the hold', () => {
    const button = renderButton(props);
    press(button);
    wait(HOLD - 100);
    fireEvent.pointerCancel(button);
    wait(HOLD);
    expect(button.getAttribute('aria-label')).toMatch(/^Press and hold to arm/);
    expect(sent()).toHaveLength(0);
  });

  it('only a primary press holds: a right-click or another button arms nothing', () => {
    const button = renderButton(props);
    fireEvent.pointerDown(button, { button: 2 });
    wait(HOLD);
    expect(button.getAttribute('aria-label')).toMatch(/^Press and hold to arm/);
    fireEvent.pointerDown(button, { button: 1 });
    wait(HOLD);
    expect(button.getAttribute('aria-label')).toMatch(/^Press and hold to arm/);
  });

  it('the second hold must start inside the window: at 3999 ms it sends, at 4000 ms it is back at the start', () => {
    let button = renderButton(props);
    press(button);
    wait(HOLD);
    release(button);
    wait(WINDOW - 1);
    press(button);
    wait(HOLD);
    expect(sent()).toHaveLength(1);
    cleanup();
    button = renderButton(props);
    press(button);
    wait(HOLD);
    release(button);
    wait(WINDOW);
    press(button);
    wait(HOLD);
    expect(sent()).toHaveLength(0);
  });

  it('a press while it shows Sent does nothing', () => {
    const button = renderButton(props);
    press(button);
    wait(HOLD);
    release(button);
    press(button);
    wait(HOLD);
    release(button);
    expect(sent()).toHaveLength(1);
    press(button);
    wait(HOLD);
    expect(button.getAttribute('aria-label')).toBe('SOS beacon sent');
    release(button);
    wait(2000);
    press(button);
    wait(HOLD);
    release(button);
    press(button);
    wait(HOLD);
    expect(sent()).toHaveLength(2);
  });

  it('letting go during the second hold sends nothing', () => {
    const button = renderButton(props);
    press(button);
    wait(HOLD);
    release(button);
    press(button);
    wait(HOLD - 100);
    release(button);
    wait(HOLD);
    expect(sent()).toHaveLength(0);
  });
});

describe('where it stands', () => {
  it('on its one layer, in its usual spot', () => {
    const button = renderButton();
    expect(Number(button.style.zIndex)).toBe(LAYER.emergencyButton);
    expect(button.className).toMatch(/(^| )bottom-20( |$)/);
    expect(button.className).toMatch(/(^| )left-4( |$)/);
  });

  it('that layer is above every other screen and below an incoming alert', () => {
    for (const [name, z] of Object.entries(LAYER)) {
      if (name === 'emergencyButton') continue;
      if (name === 'emergency') expect(LAYER.emergencyButton).toBeLessThan(z);
      else expect(LAYER.emergencyButton, name).toBeGreaterThan(z);
    }
  });
});

// Through the app's outbox (utils/sosOutbox.js), the button says "Sent" only once the server has
// answered the alert. It used to say so the moment the second hold completed: seen on a phone,
// it read "Sent" while the alert sat on a connection that had already died (2026-10-28).
describe('with the outbox: "Sent" waits for the server', () => {
  const sendViaOutbox = () => {
    const handlers = {};
    const wire = {
      connected: true,
      emit: vi.fn(),
      on: (e, fn) => { (handlers[e] ??= new Set()).add(fn); },
      off: (e, fn) => handlers[e]?.delete(fn),
      receive: (e, payload) => act(() => { [...(handlers[e] ?? [])].forEach((fn) => fn(payload)); }),
    };
    const outbox = createSosOutbox(wire);
    outbox.markInGroup();
    socket = wire;
    render(<SosTrigger outbox={outbox} getLocation={() => ({ lat: 12.82, lng: 80.04 })} roomCode="K7M2QX" senderName="Meera" />);
    const button = screen.getByRole('button');
    press(button);
    wait(HOLD);
    release(button);
    press(button);
    wait(HOLD);
    release(button);
    const clientId = wire.emit.mock.calls.find(([e]) => e === 'sos-broadcast')[1].clientId;
    return { button, wire, clientId };
  };

  it('says Sending after the hold, and Sent only on the answer', () => {
    const { button, wire, clientId } = sendViaOutbox();
    expect(button.textContent).toMatch(/Sending/i);
    expect(button.textContent).not.toMatch(/Sent/i);
    wire.receive('alert-result', { type: 'sos', allowed: true, clientId });
    expect(button.textContent).toMatch(/Sent/i);
    wait(2000);
    expect(button.textContent).toMatch(/SOS/);
  });

  it('a refusal never shows Sent', () => {
    const { button, wire, clientId } = sendViaOutbox();
    wire.receive('alert-result', { type: 'sos', allowed: false, reasonCode: 'COOLDOWN', clientId });
    expect(button.textContent).not.toMatch(/Sent/i);
    expect(button.textContent).toMatch(/SOS/);
  });
});
