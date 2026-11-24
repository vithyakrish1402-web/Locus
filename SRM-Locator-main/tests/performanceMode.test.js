import { describe, it, expect } from 'vitest';
import { prefersLightweightUI } from '../src/utils/performanceMode';
describe('decoration budget', () => {
  it('reduces effects for either constrained memory or CPU', () => {
    expect(prefersLightweightUI({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(true);
    expect(prefersLightweightUI({ hardwareConcurrency: 4 })).toBe(true);
    expect(prefersLightweightUI({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe(true);
  });
  it('keeps regular effects for unknown or more capable hardware', () => {
    expect(prefersLightweightUI({})).toBe(false);
    expect(prefersLightweightUI({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
  });
});
