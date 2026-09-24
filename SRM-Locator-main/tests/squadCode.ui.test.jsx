// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { CodeTiles, CodeInput } from '../src/components/SquadCode.jsx';
import { __resetNotifications, subscribe } from '../src/utils/notify.js';

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
  it('keeps the real code readable to assistive tech while the tiles decrypt', () => {
    render(<CodeTiles code="QW5WKK" />);
    expect(document.querySelector('.sr-only').textContent).toBe('QW5WKK');
    expect(screen.getByRole('button', { name: /Squad code Q W 5 W K K/ })).toBeTruthy();
  });

  it('copies the code and says so', async () => {
    render(<CodeTiles code="QW5WKK" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /COPY CODE/ })); });
    expect(writeText).toHaveBeenCalledWith('QW5WKK');
    expect(screen.getByRole('button', { name: /COPIED/ })).toBeTruthy();
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /COPY CODE/ })); });
    stop();
    expect(notices.map((n) => n.title)).toEqual(['COPY_FAILED']);
    expect(screen.queryByRole('button', { name: /COPIED/ })).toBeNull();
  });

  it('offers SHARE only where the platform has a share sheet', async () => {
    const { unmount } = render(<CodeTiles code="QW5WKK" />);
    expect(screen.queryByRole('button', { name: /SHARE/ })).toBeNull();
    unmount();

    navigator.share = vi.fn(() => Promise.resolve());
    render(<CodeTiles code="QW5WKK" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /SHARE/ })); });
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('QW5WKK') }));
  });
});

describe('CodeInput', () => {
  const Harness = ({ onSubmit }) => {
    const [value, setValue] = React.useState('');
    return <CodeInput value={value} onChange={setValue} onSubmit={onSubmit} />;
  };

  it('normalises whatever is typed or pasted into the code alphabet', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('E.G. KTR7X9');
    fireEvent.change(input, { target: { value: ' ab-c 12x ' } });
    expect(input.value).toBe('ABC12X');
  });

  it('never takes more than eight characters', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('E.G. KTR7X9');
    fireEvent.change(input, { target: { value: 'ABCDEFGHJKLM' } });
    expect(input.value).toBe('ABCDEFGH');
  });

  it('submits on Enter once something is typed', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText('E.G. KTR7X9');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled(); // empty
    fireEvent.change(input, { target: { value: 'KTR7X9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
