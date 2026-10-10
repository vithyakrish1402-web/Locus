// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { CodeTiles, CodeInput } from '../src/components/SquadCode.jsx';
import { __resetNotifications, subscribe } from '../src/utils/notify.js';
import { LOBBY } from '../src/copy/access.js';

let writeText;

beforeEach(() => {
  __resetNotifications();
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  delete navigator.clipboard;
  delete navigator.share;
});

describe('CodeTiles', () => {
  it('keeps the real code readable to assistive tech', () => {
    render(<CodeTiles code="QW5WKK" />);
    expect(document.querySelector('.sr-only').textContent).toBe('QW5WKK');
    expect(screen.getByRole('button', { name: LOBBY.codeLabel('QW5WKK') })).toBeTruthy();
  });

  it('copies the code and says so', async () => {
    render(<CodeTiles code="QW5WKK" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: LOBBY.copy })); });
    expect(writeText).toHaveBeenCalledWith('QW5WKK');
    expect(screen.getByRole('button', { name: LOBBY.copied })).toBeTruthy();
  });

  it('copies when the tiles themselves are tapped', async () => {
    render(<CodeTiles code="QW5WKK" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Tap to copy/ })); });
    expect(writeText).toHaveBeenCalledWith('QW5WKK');
  });

  it('posts a notice instead of failing silently when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    document.execCommand = vi.fn(() => false);
    let notices = [];
    const stop = subscribe((items) => { notices = items; });
    render(<CodeTiles code="QW5WKK" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: LOBBY.copy })); });
    stop();
    expect(notices.map((n) => [n.severity, n.message])).toEqual([['warning', LOBBY.copyFailed]]);
    expect(screen.queryByRole('button', { name: LOBBY.copied })).toBeNull();
  });

  it('offers Share code only where the platform has a share sheet (Copy code otherwise)', async () => {
    const { unmount } = render(<CodeTiles code="QW5WKK" />);
    expect(screen.queryByRole('button', { name: LOBBY.share })).toBeNull();
    expect(screen.getByRole('button', { name: LOBBY.copy })).toBeTruthy();
    unmount();

    navigator.share = vi.fn(() => Promise.resolve());
    render(<CodeTiles code="QW5WKK" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: LOBBY.share })); });
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('QW5WKK') }));
  });
});

describe('CodeTiles: New code', () => {
  it('asks for a new code when tapped', () => {
    const onNewCode = vi.fn();
    render(<CodeTiles code="QW5WKK" onNewCode={onNewCode} />);
    fireEvent.click(screen.getByRole('button', { name: LOBBY.newCode }));
    expect(onNewCode).toHaveBeenCalledTimes(1);
  });
});

describe('CodeInput', () => {
  const Harness = ({ onSubmit }) => {
    const [value, setValue] = React.useState('');
    return <CodeInput value={value} onChange={setValue} onSubmit={onSubmit} />;
  };

  it('normalises whatever is typed or pasted into the code alphabet', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText(LOBBY.joinPlaceholder);
    fireEvent.change(input, { target: { value: ' ab-c 12x ' } });
    expect(input.value).toBe('ABC12X');
  });

  it('never takes more than eight characters', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText(LOBBY.joinPlaceholder);
    fireEvent.change(input, { target: { value: 'ABCDEFGHJKLM' } });
    expect(input.value).toBe('ABCDEFGH');
  });

  it('marks the field invalid, and reads the reason with it, when the code was turned down', () => {
    render(<><CodeInput value="ZZZ9ZZ" onChange={() => {}} problem describedBy="why" /><p id="why">No group</p></>);
    const input = screen.getByRole('textbox', { name: LOBBY.joinCode });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('why');
  });

  it('submits on Enter once something is typed', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText(LOBBY.joinPlaceholder);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled(); // empty
    fireEvent.change(input, { target: { value: 'KTR7X9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
