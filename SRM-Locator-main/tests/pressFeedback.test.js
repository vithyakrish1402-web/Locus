// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installPressFeedback, pressableFor } from '../src/utils/pressFeedback.js';

// jsdom has no PointerEvent constructor; a MouseEvent carrying the pointer fields is what
// the listener reads.
const press = (target, { x = 10, y = 20, pointerType = 'touch', button = 0 } = {}) => {
  const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
};
const rings = () => document.querySelectorAll('.locus-ping');

let uninstall;
let vibrate;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <button id="plain">Go</button>
    <button id="disabled" disabled>No</button>
    <button id="icon"><svg><path id="inner"></path></svg></button>
    <div id="map" data-no-ping><button id="marker">pin</button></div>
    <p id="text">just words</p>
    <div role="button" id="role">custom</div>`;
  vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  uninstall = installPressFeedback(document);
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
  delete navigator.vibrate;
});

describe('the sonar ping', () => {
  it('leaves the exact point a control was pressed', () => {
    press(document.getElementById('plain'), { x: 42, y: 77 });
    expect(rings()).toHaveLength(1);
    expect(rings()[0].style.left).toBe('42px');
    expect(rings()[0].style.top).toBe('77px');
    expect(rings()[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('is drawn outside the control, so it can never shift a layout', () => {
    press(document.getElementById('plain'));
    expect(rings()[0].parentElement).toBe(document.body);
    expect(document.getElementById('plain').children).toHaveLength(0);
  });

  it('counts a press on an icon inside a control', () => {
    press(document.getElementById('inner'));
    expect(rings()).toHaveLength(1);
    expect(pressableFor(document.getElementById('inner'))?.id).toBe('icon');
  });

  it('answers role="button" elements too', () => {
    press(document.getElementById('role'));
    expect(rings()).toHaveLength(1);
  });

  it('ignores plain content, disabled controls, opted-out areas and non-primary buttons', () => {
    press(document.getElementById('text'));
    press(document.getElementById('disabled'));
    press(document.getElementById('marker'));
    press(document.getElementById('plain'), { button: 2 });
    expect(rings()).toHaveLength(0);
  });

  it('removes each ring when its animation ends, or after a fallback delay', () => {
    press(document.getElementById('plain'));
    const first = rings()[0];
    first.dispatchEvent(new Event('animationend'));
    expect(rings()).toHaveLength(0);

    press(document.getElementById('plain')); // animationend never comes (hidden tab)
    expect(rings()).toHaveLength(1);
    vi.advanceTimersByTime(800);
    expect(rings()).toHaveLength(0);
  });

  it('never keeps more than six rings alive, however fast the taps', () => {
    for (let i = 0; i < 20; i++) press(document.getElementById('plain'), { x: i });
    expect(rings()).toHaveLength(6);
    expect(rings()[5].style.left).toBe('19px'); // the newest survive
  });

  it('ticks the vibration motor on touch, not on a mouse click', () => {
    press(document.getElementById('plain'), { pointerType: 'mouse' });
    expect(vibrate).not.toHaveBeenCalled();
    press(document.getElementById('plain'), { pointerType: 'touch' });
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it('survives a WebView whose vibrate() throws', () => {
    vibrate.mockImplementation(() => { throw new Error('not allowed'); });
    expect(() => press(document.getElementById('plain'))).not.toThrow();
    expect(rings()).toHaveLength(1);
  });

  it('stops listening, and clears live rings, when uninstalled', () => {
    press(document.getElementById('plain'));
    uninstall();
    expect(rings()).toHaveLength(0);
    press(document.getElementById('plain'));
    expect(rings()).toHaveLength(0);
    uninstall = () => {};
  });
});
