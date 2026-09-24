// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useIsMobile } from '../src/hooks/useIsMobile.js';

// A controllable matchMedia: the viewport's width, and the listeners React registered.
let width = 412;
const listeners = new Set();
window.matchMedia = (query) => ({
  get matches() {
    const max = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1]);
    return width <= max;
  },
  media: query,
  addEventListener: (_type, fn) => listeners.add(fn),
  removeEventListener: (_type, fn) => listeners.delete(fn),
});
const resizeTo = (w) => act(() => { width = w; listeners.forEach((fn) => fn()); });

afterEach(() => {
  cleanup();
  width = 412;
});

describe('useIsMobile', () => {
  it('is true at phone width and false at desktop width', () => {
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    width = 1280;
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it('follows the viewport as it changes - a rotation or a split screen', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    resizeTo(900);
    expect(result.current).toBe(false);
    resizeTo(767);
    expect(result.current).toBe(true);
  });

  it('switches exactly at the md breakpoint', () => {
    width = 767;
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    width = 768;
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it('stops listening when unmounted', () => {
    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
