// @vitest-environment jsdom
//
// The received Emergency alert (SosOverlay.jsx; redesign Emergency batch, E4 and E5): who
// needs help, how long ago, where their phone's last known location is from here (13a),
// "1 of 2" when alerts are queued, the footer line, and Acknowledge as the only way out. The
// alarm and vibration are unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import SosOverlay from '../src/components/SosOverlay.jsx';
import { SOS_RECEIVED } from '../src/copy/emergency.js';
import { LAYER } from '../src/utils/layers.js';

// The klaxon itself is covered in useAlertAudio.test.jsx; here we only care that the
// overlay starts/stops it at the right moments.
const audio = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('../src/hooks/useAlertAudio', () => ({ useAlertAudio: () => audio }));

const HERE = { lat: 12.8230, lng: 80.0440 };
// About 120 m north of HERE.
const NORTH_120 = { lat: 12.8230 + 120 / 111320, lng: 80.0440 };

const renderOverlay = (props = {}) => {
  const onAcknowledge = vi.fn();
  const utils = render(
    <SosOverlay senderName="Bravo" lat={12.82313} lng={80.04421} onAcknowledge={onAcknowledge} {...props} />
  );
  return { onAcknowledge, ...utils };
};
const location = () => screen.getByTestId('sos-location').textContent;
const description = () => {
  const dialog = screen.getByRole('alertdialog');
  return document.getElementById(dialog.getAttribute('aria-describedby')).textContent;
};

beforeEach(() => {
  navigator.vibrate = vi.fn();
  audio.start.mockClear();
  audio.stop.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('who and when', () => {
  it('says who needs help, in their own name', () => {
    renderOverlay();
    expect(screen.getByRole('heading', { name: 'Bravo needs help' })).toBeTruthy();
    expect(screen.getByText(SOS_RECEIVED.kicker)).toBeTruthy();
  });

  it('copes with no name without inventing one', () => {
    renderOverlay({ senderName: null });
    expect(screen.getByRole('heading', { name: 'Someone in your group needs help' })).toBeTruthy();
  });

  it('a live alert was sent just now; a replayed one says how old it is', () => {
    const { unmount } = renderOverlay({ ageMs: 0, receivedAt: Date.now() });
    expect(screen.getByTestId('sos-age').textContent).toBe('Sent just now');
    unmount();
    renderOverlay({ ageMs: 12 * 60000 + 5000, receivedAt: Date.now() });
    expect(screen.getByTestId('sos-age').textContent).toBe('Sent 12 min ago');
  });

  it("goes on counting while it is up, on this phone's clock (the server's age, plus the time since it arrived)", () => {
    vi.useFakeTimers();
    renderOverlay({ ageMs: 30000, receivedAt: Date.now() });
    expect(screen.getByTestId('sos-age').textContent).toBe('Sent just now');
    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.getByTestId('sos-age').textContent).toBe('Sent 1 min ago');
    act(() => { vi.advanceTimersByTime(4 * 60000); });
    expect(screen.getByTestId('sos-age').textContent).toBe('Sent 5 min ago');
  });
});

describe('where (13a)', () => {
  it('with a location and a compass: their phone\'s last known location, about how far, and a clock direction', () => {
    renderOverlay({ ...NORTH_120, me: HERE, heading: 0, headingLive: true });
    expect(location()).toBe("Their phone's last known location · about 120 m · straight ahead");
    renderOverlay({ ...NORTH_120, me: HERE, heading: 270, headingLive: true });
    expect(screen.getAllByTestId('sos-location')[1].textContent).toBe("Their phone's last known location · about 120 m · 3 o’clock");
  });

  it('without a compass: compass words instead of a clock', () => {
    renderOverlay({ ...NORTH_120, me: HERE });
    expect(location()).toBe("Their phone's last known location · about 120 m · to the north");
  });

  it('with no position of our own: their coordinates', () => {
    renderOverlay();
    expect(location()).toBe("Their phone's last known location · 12.8231, 80.0442");
  });

  it('no location came with it: says exactly that, and invents nothing', () => {
    renderOverlay({ lat: null, lng: null, me: HERE });
    expect(location()).toBe('No location came with this alert');
    expect(screen.getByTestId('sos-location').dataset.hasLocation).toBeUndefined();
    expect(document.body.textContent).not.toMatch(/last seen|near/i);
  });
});

describe('queued alerts', () => {
  it('"1 of 2" only when more than one is in this run', () => {
    const { unmount } = renderOverlay({ position: 1, total: 1 });
    expect(screen.queryByTestId('sos-counter')).toBeNull();
    unmount();
    renderOverlay({ position: 1, total: 2 });
    expect(screen.getByTestId('sos-counter').textContent).toBe('1 of 2');
  });
});

describe('the footer', () => {
  it('says what an alert carries, and that it stays until acknowledged', () => {
    renderOverlay();
    expect(screen.getByTestId('sos-footer').textContent).toBe(SOS_RECEIVED.footer);
  });
});

describe('the look', () => {
  it('a red band in the emergency colour; no glow, no flashing frame, no old grid', () => {
    const { container } = renderOverlay();
    expect(screen.getByTestId('sos-band').className).toContain('bg-emergency');
    expect(container.innerHTML).not.toMatch(/locus-sos-strobe|box-shadow|Tactical Grid|sos-hex-pattern|font-dot|#4A0A0A|#EF4444/i);
  });
});

describe('above everything', () => {
  it('stands on the top layer of the app: over AR Scan, sheets, notices and the update screens', () => {
    renderOverlay();
    expect(Number(screen.getByRole('alertdialog').style.zIndex)).toBe(LAYER.emergency);
    for (const [name, z] of Object.entries(LAYER)) {
      if (name !== 'emergency') expect(LAYER.emergency, name).toBeGreaterThan(z);
    }
  });
});

describe('Acknowledge is the only way out', () => {
  it('exposes exactly one button, and it acknowledges (stopping the klaxon first)', () => {
    const { onAcknowledge } = renderOverlay();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Acknowledge');

    fireEvent.click(buttons[0]);
    expect(audio.stop).toHaveBeenCalled();
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('is not dismissed by Escape, wherever the key lands', () => {
    const { onAcknowledge } = renderOverlay();
    const dialog = screen.getByRole('alertdialog');
    const button = screen.getByRole('button');
    [dialog, button, document.body, document].forEach((target) => {
      fireEvent.keyDown(target, { key: 'Escape', code: 'Escape' });
      fireEvent.keyUp(target, { key: 'Escape', code: 'Escape' });
    });
    expect(onAcknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('is not dismissed by tapping anywhere else on it', () => {
    const { onAcknowledge } = renderOverlay();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.pointerDown(dialog);
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    fireEvent.click(screen.getByRole('heading'));
    fireEvent.click(screen.getByTestId('sos-band'));
    fireEvent.click(screen.getByTestId('sos-location'));
    fireEvent.click(screen.getByTestId('sos-footer'));
    expect(onAcknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('never times out', () => {
    vi.useFakeTimers();
    const { onAcknowledge } = renderOverlay();
    act(() => { vi.advanceTimersByTime(60 * 60 * 1000); }); // an hour
    expect(onAcknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

describe('alarm and vibration, unchanged', () => {
  it('starts the klaxon and vibrates [300,150,300,150,300] on mount, and stops the klaxon on unmount', () => {
    const { unmount } = renderOverlay();
    expect(audio.start).toHaveBeenCalled();
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);
    expect(navigator.vibrate).toHaveBeenCalledWith([300, 150, 300, 150, 300]);
    audio.stop.mockClear();
    unmount();
    expect(audio.stop).toHaveBeenCalled();
  });

  it('does not blow up on devices without vibration', () => {
    delete navigator.vibrate;
    expect(() => renderOverlay()).not.toThrow();
  });
});

describe('screen readers', () => {
  it('a modal alert dialog, named by who needs help and described in full sentences', () => {
    renderOverlay({ ...NORTH_120, me: HERE, heading: 0, headingLive: true, ageMs: 3 * 60000, receivedAt: Date.now(), position: 1, total: 2 });
    const dialog = screen.getByRole('alertdialog', { name: 'Bravo needs help' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(description()).toBe("Bravo needs help. Sent 3 min ago. Their phone's last known location · about 120 m · straight ahead. Alert 1 of 2. Activate Acknowledge to dismiss.");
  });

  it('says plainly when no location came, and invents no sender', () => {
    renderOverlay({ senderName: '', lat: undefined, lng: undefined });
    expect(description()).toContain('Someone in your group needs help.');
    expect(description()).toContain('No location came with this alert.');
  });

  it('hides its icons from assistive tech', () => {
    const { container } = renderOverlay();
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.closest('[aria-hidden="true"]') || svg.getAttribute('aria-hidden') === 'true').toBeTruthy();
    }
  });
});

describe('focus', () => {
  it('takes focus on open, on the Acknowledge button', () => {
    renderOverlay();
    expect(document.activeElement).toBe(screen.getByRole('button'));
  });

  it('keeps focus on Acknowledge when Tab is pressed (in either direction)', () => {
    renderOverlay();
    const button = screen.getByRole('button');
    expect(fireEvent.keyDown(button, { key: 'Tab' })).toBe(false); // default prevented
    expect(fireEvent.keyDown(button, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('pulls focus back if something behind the overlay grabs it', () => {
    const behind = document.createElement('button');
    document.body.appendChild(behind);
    renderOverlay();

    behind.focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Acknowledge' }));
    behind.remove();
  });

  it('hands focus back to whatever had it before, once closed', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = renderOverlay();
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('stops policing focus after it closes', () => {
    const behind = document.createElement('button');
    document.body.appendChild(behind);
    const { unmount } = renderOverlay();
    unmount();

    behind.focus();
    expect(document.activeElement).toBe(behind);
    behind.remove();
  });
});
