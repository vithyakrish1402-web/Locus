import { describe, it, expect, vi } from 'vitest';
import { pushBackHandler, runBackHandler } from '../src/utils/backHandlers';

describe('back handler stack', () => {
  it('runs only the newest handler, falls through when declined or empty', () => {
    expect(runBackHandler()).toBe(false);
    const a = vi.fn(); const b = vi.fn();
    const offA = pushBackHandler(a); const offB = pushBackHandler(b);
    expect(runBackHandler()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1); expect(a).not.toHaveBeenCalled();
    offB(); expect(runBackHandler()).toBe(true); expect(a).toHaveBeenCalledTimes(1);
    offA(); expect(runBackHandler()).toBe(false);
    const off = pushBackHandler(() => false);
    expect(runBackHandler()).toBe(false); off();
  });
});
