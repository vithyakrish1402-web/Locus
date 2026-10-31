// @vitest-environment jsdom
import { it, expect, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useStableAction } from '../src/hooks/useStableAction';
afterEach(cleanup);
it('keeps a stable identity while using the latest committed action', () => {
  const oldAction = vi.fn(), latestAction = vi.fn();
  const { result, rerender } = renderHook(({ action }) => useStableAction(action), { initialProps: { action: oldAction } });
  const first = result.current;
  rerender({ action: latestAction });
  expect(result.current).toBe(first);
  first('new-location');
  expect(latestAction).toHaveBeenCalledWith('new-location');
  expect(oldAction).not.toHaveBeenCalled();
});
