// Where the phone's Buildings / Group panel settles when the finger lets go (hooks/usePanelMotion.js).
import { describe, it, expect } from 'vitest';
import {
  settlePanel,
  PANEL_SNAP_DISTANCE_RATIO,
  PANEL_SNAP_VELOCITY_THRESHOLD,
} from '../src/hooks/usePanelMotion.js';

const height = 700;
const far = PANEL_SNAP_DISTANCE_RATIO * height;
const fast = PANEL_SNAP_VELOCITY_THRESHOLD + 0.1;
const slow = PANEL_SNAP_VELOCITY_THRESHOLD - 0.1;

describe('settlePanel', () => {
  it('a short slow pull from open goes back open', () => {
    expect(settlePanel({ y: far - 10, grabY: 0, velocity: slow, height })).toBe('open');
  });

  it('pulled further than the distance ratio, it closes, even let go still', () => {
    expect(settlePanel({ y: far + 10, grabY: 0, velocity: 0, height })).toBe('closed');
  });

  it('a quick flick down closes from a short pull, and a quick flick up opens from a long one', () => {
    expect(settlePanel({ y: 20, grabY: 0, velocity: fast, height })).toBe('closed');
    expect(settlePanel({ y: height * 0.9, grabY: height * 0.9, velocity: -fast, height })).toBe('open');
  });

  it('dragged far back up from low down, it opens in the direction of travel', () => {
    expect(settlePanel({ y: height * 0.55, grabY: height * 0.95, velocity: 0, height })).toBe('open');
  });

  it('grabbed mid-movement and let go without travel or speed, it goes to the nearer end', () => {
    expect(settlePanel({ y: height * 0.3, grabY: height * 0.3, velocity: 0, height })).toBe('open');
    expect(settlePanel({ y: height * 0.7, grabY: height * 0.7, velocity: 0, height })).toBe('closed');
  });

  it('with no height measured yet it stays open', () => {
    expect(settlePanel({ y: 0, grabY: 0, velocity: 9, height: 0 })).toBe('open');
  });
});
