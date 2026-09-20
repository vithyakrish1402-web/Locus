import { describe, it, expect } from 'vitest';
import { deriveMarkerStatus, MOVING_SPEED_THRESHOLD_MS } from '../src/utils/markerStatus';

describe('markerStatus Utility', () => {
  it('defines the moving speed threshold at 0.5 m/s', () => {
    expect(MOVING_SPEED_THRESHOLD_MS).toBe(0.5);
  });

  it('marks speeds <= 0.5 m/s as stationary', () => {
    expect(deriveMarkerStatus(0)).toBe('stationary');
    expect(deriveMarkerStatus(0.3)).toBe('stationary');
    expect(deriveMarkerStatus(0.5)).toBe('stationary');
  });

  it('marks speeds > 0.5 m/s as moving', () => {
    expect(deriveMarkerStatus(0.51)).toBe('moving');
    expect(deriveMarkerStatus(1.5)).toBe('moving');
    expect(deriveMarkerStatus(10.0)).toBe('moving');
  });
});
