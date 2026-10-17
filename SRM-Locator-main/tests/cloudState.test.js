import { describe, it, expect } from 'vitest';
import { CLOUD_CLOSED, cloudReducer as r } from '../src/utils/cloudState';

describe('building popup state machine', () => {
  it('closed -> peek on select, peek -> open on expand', () => {
    const peek = r(CLOUD_CLOSED, { type: 'select', id: 1 });
    expect(peek).toEqual({ phase: 'peek', id: 1 });
    expect(r(peek, { type: 'expand' })).toEqual({ phase: 'open', id: 1 });
  });
  it('select with open goes straight to the sheet', () => {
    expect(r(CLOUD_CLOSED, { type: 'select', id: 1, open: true })).toEqual({ phase: 'open', id: 1 });
  });
  it('open -> peek on collapse, and collapse/expand are no-ops elsewhere', () => {
    expect(r({ phase: 'open', id: 1 }, { type: 'collapse' })).toEqual({ phase: 'peek', id: 1 });
    expect(r(CLOUD_CLOSED, { type: 'collapse' })).toBe(CLOUD_CLOSED);
    const open = { phase: 'open', id: 1 };
    expect(r(open, { type: 'expand' })).toBe(open);
  });
  it('selecting another building swaps to its cloud, even from open', () => {
    expect(r({ phase: 'open', id: 1 }, { type: 'select', id: 2 })).toEqual({ phase: 'peek', id: 2 });
    expect(r({ phase: 'peek', id: 1 }, { type: 'select', id: 2 })).toEqual({ phase: 'peek', id: 2 });
  });
  it('re-selecting the same building does not reset an open sheet', () => {
    const open = { phase: 'open', id: 1 };
    expect(r(open, { type: 'select', id: 1 })).toBe(open);
  });
  it('dismiss, or selecting nothing, closes from any phase', () => {
    expect(r({ phase: 'open', id: 1 }, { type: 'dismiss' })).toEqual(CLOUD_CLOSED);
    expect(r({ phase: 'peek', id: 1 }, { type: 'select', id: null })).toEqual(CLOUD_CLOSED);
  });
});
