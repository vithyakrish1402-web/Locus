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
  ['on its own layer', {}],
  ['standing above AR Scan', { layer: LAYER.emergencyButtonOverArScan }],
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
  it('on its own layer by default, in its usual spot', () => {
    const button = renderButton();
    expect(button.style.zIndex).toBe('');
    expect(button.className).toMatch(/(^| )z-\[1150\]( |$)/);
    expect(button.className).toMatch(/(^| )bottom-20( |$)/);
    expect(button.className).toMatch(/(^| )left-4( |$)/);
  });

  it('given a layer, on that layer, in the same spot', () => {
    const button = renderButton({ layer: LAYER.emergencyButtonOverArScan });
    expect(Number(button.style.zIndex)).toBe(LAYER.emergencyButtonOverArScan);
    expect(button.className).toMatch(/(^| )bottom-20( |$)/);
    expect(button.className).toMatch(/(^| )left-4( |$)/);
  });

  it('that layer is above AR Scan and below an incoming alert', () => {
    expect(LAYER.emergencyButtonOverArScan).toBeGreaterThan(LAYER.arScan);
    expect(LAYER.emergencyButtonOverArScan).toBeLessThan(LAYER.emergency);
  });
});
