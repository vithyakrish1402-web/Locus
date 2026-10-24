// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useBlurOnKeyboardHide } from '../src/hooks/useBlurOnKeyboardHide.js';

function Probe() {
  useBlurOnKeyboardHide();
  return <input data-testid="box" type="search" />;
}

const setSize = (width, height) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  act(() => { window.dispatchEvent(new Event('resize')); });
};

beforeEach(() => setSize(400, 800));
afterEach(cleanup);

const focused = () => {
  const { getByTestId } = render(<Probe />);
  const box = getByTestId('box');
  box.focus();
  return box;
};

describe('a text field when the keyboard goes', () => {
  it('lets go of focus when the window grows back to its full height', () => {
    const box = focused();
    setSize(400, 480); // keyboard up
    expect(document.activeElement).toBe(box);
    setSize(400, 800); // keyboard hidden
    expect(document.activeElement).not.toBe(box);
  });

  it('keeps focus while the keyboard is up, however the window moves a little', () => {
    const box = focused();
    setSize(400, 480);
    setSize(400, 500); // the keyboard changed shape
    setSize(400, 470);
    expect(document.activeElement).toBe(box);
  });

  it('keeps focus when the keyboard changes shape without leaving (no full-height window)', () => {
    const box = focused();
    setSize(400, 450);
    setSize(400, 600); // a shorter keyboard (a split one), still up
    expect(document.activeElement).toBe(box);
  });

  it('does not treat a rotation as the keyboard going', () => {
    const box = focused();
    setSize(400, 480);
    setSize(800, 400); // rotated: new width, new baseline
    setSize(800, 400);
    expect(document.activeElement).toBe(box);
  });

  it('leaves non-text focus alone', () => {
    const { getByTestId } = render(<><Probe /><button data-testid="b" type="button">b</button></>);
    const b = getByTestId('b');
    b.focus();
    setSize(400, 480);
    setSize(400, 800);
    expect(document.activeElement).toBe(b);
  });
});
