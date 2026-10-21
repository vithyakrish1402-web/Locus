// @vitest-environment jsdom
//
// A sheet let go after a drag (components/ui/Sheet): short of closing, it settles back open
// on the sheet spring; with the phone's animations off, on a 150 ms ease and no spring. A
// long enough throw closes it either way.
//
// jsdom can't drag, so the panel's onDragEnd is called the way framer-motion calls it
// (offset and velocity of the drag), and the panel's animation controls are watched to see
// how the settle runs. useReducedMotion stands in for the phone's setting.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const state = vi.hoisted(() => ({ reduceMotion: false, dialogProps: null, starts: [] }));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  const React = await import('react');
  // motion.div, recording the props of the sheet's panel (the one that is a dialog).
  const Div = React.forwardRef((props, ref) => {
    if (props.role === 'dialog') state.dialogProps = props;
    return React.createElement(actual.motion.div, { ...props, ref });
  });
  const motion = new Proxy(actual.motion, { get: (target, key) => (key === 'div' ? Div : target[key]) });
  return {
    ...actual,
    motion,
    // The real controls, with every start() recorded.
    useAnimationControls: () => {
      const controls = actual.useAnimationControls();
      if (!controls.__watched) {
        const start = controls.start.bind(controls);
        controls.start = (definition) => { state.starts.push(definition); return start(definition); };
        controls.__watched = true;
      }
      return controls;
    },
    useReducedMotion: () => state.reduceMotion,
  };
});

const { MotionGlobalConfig } = await import('framer-motion');
const { default: Sheet } = await import('../src/components/ui/Sheet.jsx');
const { SHEET_SPRING } = await import('../src/utils/motion.js');

MotionGlobalConfig.skipAnimations = true;

let onClose;
const openSheet = () => {
  onClose = vi.fn();
  render(<Sheet open onClose={onClose} title="Meera Iyer"><button type="button">Ping Meera</button></Sheet>);
};
// What the panel was told to do after it opened (its own entrance is the first start).
const settles = () => state.starts.slice(1);
// Let go after dragging `offset` px down at `velocity` px/s.
const letGo = (offset, velocity = 0) => act(() => {
  state.dialogProps.onDragEnd({}, { offset: { x: 0, y: offset }, velocity: { x: 0, y: velocity } });
});

beforeEach(() => {
  state.reduceMotion = false;
  state.dialogProps = null;
  state.starts = [];
  // jsdom lays nothing out; give the panel a height for the "how far down" decision.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 400 });
});

afterEach(() => {
  cleanup();
  delete HTMLElement.prototype.offsetHeight;
});

describe('letting go of a sheet', () => {
  it('animations on: settles back open on the sheet spring', () => {
    openSheet();
    letGo(40);
    expect(onClose).not.toHaveBeenCalled();
    expect(settles()).toHaveLength(1);
    const { y, transition } = settles()[0];
    expect(y).toBe(0);
    expect(transition).toBe(SHEET_SPRING);
  });

  it('animations off: settles back open with a 150 ms ease, no spring', () => {
    state.reduceMotion = true;
    openSheet();
    letGo(40);
    expect(onClose).not.toHaveBeenCalled();
    const { y, transition } = settles()[0];
    expect(y).toBe(0);
    expect(transition.duration).toBe(0.15);
    expect(transition.ease).toEqual([0.2, 0, 0, 1]);
    expect(transition.type).toBeUndefined();
    expect(transition).not.toHaveProperty('bounce');
  });

  it.each([false, true])('animations off=%s: a long enough throw closes it, with no settle', (reduce) => {
    state.reduceMotion = reduce;
    openSheet();
    letGo(60, 900);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(settles()).toEqual([]);
  });

  it('opens fully either way (the entrance is the first thing the controls do)', () => {
    openSheet();
    expect(state.starts[0]).toMatchObject({ y: 0 });
    cleanup();
    state.starts = [];
    state.reduceMotion = true;
    openSheet();
    expect(state.starts[0]).toMatchObject({ opacity: 1 });
  });

  it('still follows the finger with animations off (the drag stays on)', () => {
    state.reduceMotion = true;
    openSheet();
    expect(state.dialogProps.drag).toBe('y');
  });
});
