// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SosOverlay from '../src/components/SosOverlay.jsx';

// The klaxon itself is covered in useAlertAudio.test.jsx; here we only care that the
// overlay starts/stops it at the right moments.
const audio = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('../src/hooks/useAlertAudio', () => ({ useAlertAudio: () => audio }));

const renderOverlay = (props = {}) => {
  const onAcknowledge = vi.fn();
  const utils = render(
    <SosOverlay senderName="Bravo" lat={12.82313} lng={80.04421} onAcknowledge={onAcknowledge} {...props} />
  );
  return { onAcknowledge, ...utils };
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

describe('SosOverlay content', () => {
  it('shows who sent it and where, to four decimals', () => {
    renderOverlay();
    expect(screen.getByText('BRAVO')).toBeTruthy();
    expect(screen.getByText('12.8231, 80.0442')).toBeTruthy();
    expect(screen.getByText(/Transmitting \/\/ Unacknowledged/)).toBeTruthy();
  });

  it('says so when there are no coordinates, and copes with no name', () => {
    renderOverlay({ senderName: null, lat: null, lng: null });
    expect(screen.getByText('UNKNOWN NODE')).toBeTruthy();
    expect(screen.getByText('COORDINATES UNAVAILABLE')).toBeTruthy();
  });

  it('says how old a replayed SOS is, but only once it is at least a minute old', () => {
    const { unmount } = renderOverlay({ ageMs: 12 * 60000 + 5000 });
    expect(screen.getByText(/Sent 12 min ago \/\/ Unacknowledged/)).toBeTruthy();
    unmount();

    renderOverlay({ ageMs: 45000 });
    expect(screen.getByText(/Transmitting \/\/ Unacknowledged/)).toBeTruthy();
  });

  it('shows how many more SOS are queued behind this one', () => {
    const { unmount } = renderOverlay();
    expect(screen.queryByText(/more waiting/)).toBeNull();
    unmount();

    renderOverlay({ pendingCount: 2 });
    expect(screen.getByText('+2 more waiting')).toBeTruthy();
  });
});

describe('SosOverlay dismissal — ACKNOWLEDGE is the only way out', () => {
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

  it('is not dismissed by clicking outside the content, on the backdrop or on the text', () => {
    const { onAcknowledge } = renderOverlay();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.pointerDown(dialog);
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog); // the full-viewport backdrop
    fireEvent.click(screen.getByText('BRAVO'));
    fireEvent.click(screen.getByText('SOS'));
    expect(onAcknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('never times out', () => {
    vi.useFakeTimers();
    const { onAcknowledge } = renderOverlay();
    vi.advanceTimersByTime(60 * 60 * 1000); // an hour
    expect(onAcknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

describe('SosOverlay alarm', () => {
  it('starts the klaxon and vibrates on mount, and stops the klaxon on unmount', () => {
    const { unmount } = renderOverlay();
    expect(audio.start).toHaveBeenCalled();
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

describe('SosOverlay accessibility', () => {
  it('is a modal alert dialog, named "SOS" and described in full sentences', () => {
    renderOverlay({ pendingCount: 1, ageMs: 3 * 60000 });
    const dialog = screen.getByRole('alertdialog', { name: 'SOS' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const description = document.getElementById(dialog.getAttribute('aria-describedby')).textContent;
    expect(description).toContain('Bravo has triggered an SOS beacon.');
    expect(description).toContain('Last known position 12.8231, 80.0442.');
    expect(description).toContain('Sent 3 minutes ago.');
    expect(description).toContain('1 more SOS alert is waiting after this one.');
    expect(description).toContain('Activate Acknowledge to dismiss.');
  });

  it('describes a missing position and an unknown sender without inventing details', () => {
    renderOverlay({ senderName: '', lat: undefined, lng: undefined });
    const dialog = screen.getByRole('alertdialog');
    const description = document.getElementById(dialog.getAttribute('aria-describedby')).textContent;
    expect(description).toContain('An unknown squad member has triggered an SOS beacon.');
    expect(description).toContain('Position unavailable.');
    expect(description).not.toContain('Sent');
  });

  it('hides the decorative hex grid and strobing frame from assistive tech', () => {
    const { container } = renderOverlay();
    expect(container.querySelector('svg').closest('[aria-hidden="true"]')).toBeTruthy();
    expect(container.querySelector('.locus-sos-strobe').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('SosOverlay focus handling', () => {
  it('takes focus on open, on the ACKNOWLEDGE button', () => {
    renderOverlay();
    expect(document.activeElement).toBe(screen.getByRole('button'));
  });

  it('keeps focus on ACKNOWLEDGE when Tab is pressed (in either direction)', () => {
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
