// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { markSheetOpen, useAnySheetOpen } from '../src/utils/openSheets.js';

describe('the open sheet count', () => {
  it('is true while any sheet is open, and only then', () => {
    const { result } = renderHook(() => useAnySheetOpen());
    expect(result.current).toBe(false);
    let closeA; let closeB;
    act(() => { closeA = markSheetOpen(); });
    expect(result.current).toBe(true);
    act(() => { closeB = markSheetOpen(); });
    act(() => closeA());
    expect(result.current).toBe(true);
    act(() => closeB());
    expect(result.current).toBe(false);
  });

  it('closing the same sheet twice counts once', () => {
    const { result } = renderHook(() => useAnySheetOpen());
    let close;
    act(() => { close = markSheetOpen(); });
    act(() => { close(); close(); });
    expect(result.current).toBe(false);
    let other;
    act(() => { other = markSheetOpen(); });
    expect(result.current).toBe(true);
    act(() => other());
  });
});
