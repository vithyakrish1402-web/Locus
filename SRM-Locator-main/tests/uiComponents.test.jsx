// @vitest-environment jsdom
//
// The redesign's shared parts (src/components/ui): what each does, not how it looks (the
// look is checked by eye in the preview page, both themes). Keyboard and screen-reader
// behaviour, the red-is-destructive-only rule, problems in amber, and the sheet's ways out.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import { MotionGlobalConfig } from 'framer-motion';
import { X } from 'lucide-react';
import {
  Avatar, Badge, Button, IconButton, ListRow, NoticeCard, RadioList, SegmentedControl, Sheet, Switch, TextField, initialsOf,
} from '../src/components/ui';

MotionGlobalConfig.skipAnimations = true;
afterEach(cleanup);

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Sign in</Button>);
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('type')).toBe('button');
  });

  it('uses the danger colours only when asked', () => {
    render(<><Button>Save</Button><Button variant="danger">Remove and block</Button></>);
    expect(screen.getByRole('button', { name: 'Save' }).className).not.toMatch(/danger/);
    expect(screen.getByRole('button', { name: 'Remove and block' }).className).toMatch(/bg-danger/);
  });

  it('does nothing when disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Sign in</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is named for screen readers, since it shows no text', () => {
    render(<IconButton label="Close" icon={X} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

const MODES = [
  { value: 'live', label: 'Live' },
  { value: 'paused', label: 'Paused' },
  { value: 'hidden', label: 'Hidden' },
];

function Controlled(props) {
  const { Component, options, initial } = props;
  const [value, setValue] = useState(initial);
  return <Component label="Location sharing" value={value} onChange={setValue} options={options} />;
}

describe.each([['SegmentedControl', SegmentedControl], ['RadioList', RadioList]])('%s', (_name, Component) => {
  it('is a radio group with exactly one choice checked', () => {
    render(<Controlled Component={Component} options={MODES} initial="paused" />);
    expect(screen.getByRole('radiogroup', { name: 'Location sharing' })).toBeTruthy();
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked.map((r) => r.textContent)).toEqual(['Paused']);
  });

  it('chooses on tap', () => {
    render(<Controlled Component={Component} options={MODES} initial="live" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Hidden' }));
    expect(screen.getByRole('radio', { name: 'Hidden' }).getAttribute('aria-checked')).toBe('true');
  });

  it('has one Tab stop, and the arrow keys, Home and End move the choice (wrapping round)', () => {
    render(<Controlled Component={Component} options={MODES} initial="live" />);
    const radio = (name) => screen.getByRole('radio', { name });
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1, -1]);

    fireEvent.keyDown(radio('Live'), { key: 'ArrowRight' });
    expect(radio('Paused').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('Paused'));

    fireEvent.keyDown(radio('Paused'), { key: 'End' });
    expect(radio('Hidden').getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(radio('Hidden'), { key: 'ArrowDown' });
    expect(radio('Live').getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(radio('Live'), { key: 'ArrowLeft' });
    expect(radio('Hidden').getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(radio('Hidden'), { key: 'Home' });
    expect(radio('Live').getAttribute('aria-checked')).toBe('true');
  });
});

describe('Switch', () => {
  it('is a switch that flips on tap', () => {
    const onChange = vi.fn();
    render(<Switch label="Alert sounds" checked onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: /Alert sounds/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('locked: reads as on and ignores taps (Emergency alerts, always on)', () => {
    const onChange = vi.fn();
    render(<Switch label="Emergency alerts" description="Always on" checked locked onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: /Emergency alerts/ });
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('is labelled, and its hint is read with it', () => {
    render(<TextField label="Email" hint="Your SRM email works best." />);
    const input = screen.getByLabelText('Email');
    expect(document.getElementById(input.getAttribute('aria-describedby')).textContent).toMatch(/SRM email/);
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('shows a problem in amber, never red, and marks the field invalid', () => {
    render(<TextField label="Group code" problem="No group uses this code." />);
    const input = screen.getByLabelText('Group code');
    const note = document.getElementById(input.getAttribute('aria-describedby'));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(note.textContent).toMatch(/No group/);
    expect(note.className).toMatch(/text-warning/);
    expect(`${note.className} ${input.className}`).not.toMatch(/danger|red-/);
  });
});

describe('NoticeCard', () => {
  it('can be dismissed', () => {
    const onDismiss = vi.fn();
    render(<NoticeCard tone="success" title="Meera joined the group" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('a warning is amber, not red', () => {
    const { container } = render(<NoticeCard tone="warning" title="Location is off" />);
    expect(container.innerHTML).toMatch(/text-warning/);
    expect(container.innerHTML).not.toMatch(/danger|red-/);
  });
});

describe('Avatar', () => {
  it.each([
    ['Meera Iyer', 'MI'],
    ['aarav', 'A'],
    ['  Rohan   Kumar Das ', 'RK'],
    ['', '?'],
  ])('%j -> %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });

  it('shows a photo instead of initials when there is one', () => {
    const { container } = render(<Avatar name="Meera Iyer" photo="https://example.invalid/m.png" />);
    expect(container.querySelector('img')).toBeTruthy();
    expect(container.textContent).toBe('');
  });
});

describe('Badge', () => {
  it('is hidden at zero, and named when shown', () => {
    const { container, rerender } = render(<Badge count={0} label="No join requests" />);
    expect(container.textContent).toBe('');
    rerender(<Badge count={2} label="2 join requests" />);
    expect(screen.getByLabelText('2 join requests').textContent).toBe('2');
  });
});

describe('ListRow', () => {
  it('is one button when it has an action', () => {
    const onClick = vi.fn();
    render(<ListRow title="Ping Meera" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ping Meera' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('is not a button without one', () => {
    render(<ListRow title="Meera Iyer" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

function SheetHarness({ dismissible = true }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Options</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Meera Iyer" dismissible={dismissible}>
        <button type="button">Ping Meera</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  // A tap focuses the button in Chrome (the WebView); jsdom's click doesn't, so focus it.
  const open = () => {
    const button = screen.getByRole('button', { name: 'Options' });
    button.focus();
    fireEvent.click(button);
  };
  const dialog = () => screen.queryByRole('dialog', { name: 'Meera Iyer' });

  it('is a modal dialog named by its title, with focus moved into it', () => {
    render(<SheetHarness />);
    open();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ping Meera' }));
  });

  it('closes on Escape and on the backdrop, and hands focus back', async () => {
    render(<SheetHarness />);
    open();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await act(async () => {});
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options' }));

    open();
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    await act(async () => {});
    expect(dialog()).toBeNull();
  });

  it('keeps Tab inside it', () => {
    render(<SheetHarness />);
    open();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ping Meera' }));
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('not dismissible: only its own buttons close it', async () => {
    render(<SheetHarness dismissible={false} />);
    open();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    await act(async () => {});
    expect(dialog()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {});
    expect(dialog()).toBeNull();
  });
});
