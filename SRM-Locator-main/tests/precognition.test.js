import { describe, it, expect } from 'vitest';
import { PrecognitionFilter } from '../src/utils/precognition';

describe('PrecognitionFilter (Kalman Filter)', () => {
  it('initializes with null estimates and unit error variance', () => {
    const kf = new PrecognitionFilter();
    expect(kf.latEstimate).toBeNull();
    expect(kf.lngEstimate).toBeNull();
    expect(kf.latError).toBe(1);
    expect(kf.lngError).toBe(1);
  });

  it('sets initial estimate exactly on first observation', () => {
    const kf = new PrecognitionFilter();
    const result = kf.filter(12.8237, 80.0444);
    expect(result.lat).toBe(12.8237);
    expect(result.lng).toBe(80.0444);
    expect(kf.latEstimate).toBe(12.8237);
    expect(kf.lngEstimate).toBe(80.0444);
  });

  it('dampens sudden erratic GPS spikes (sensor noise)', () => {
    const kf = new PrecognitionFilter(0.0001, 0.001);
    const initial = kf.filter(12.8237, 80.0444);

    // Sudden spike / glitch GPS measurement far away
    const spike = kf.filter(12.9000, 80.1000);

    // Smoothed value should not instantly jump all the way to the spike
    expect(spike.lat).toBeLessThan(12.9000);
    expect(spike.lat).toBeGreaterThan(initial.lat);
    expect(spike.lng).toBeLessThan(80.1000);
    expect(spike.lng).toBeGreaterThan(initial.lng);
  });

  it('converges as consistent measurements arrive', () => {
    const kf = new PrecognitionFilter();
    kf.filter(12.8237, 80.0444);

    let lastResult;
    for (let i = 0; i < 20; i++) {
      lastResult = kf.filter(12.8240, 80.0450);
    }

    expect(lastResult.lat).toBeCloseTo(12.8240, 4);
    expect(lastResult.lng).toBeCloseTo(80.0450, 4);
  });

  it('resets internal state completely upon reset()', () => {
    const kf = new PrecognitionFilter();
    kf.filter(12.8237, 80.0444);
    kf.reset();

    expect(kf.latEstimate).toBeNull();
    expect(kf.lngEstimate).toBeNull();
    expect(kf.latError).toBe(1);
    expect(kf.lngError).toBe(1);
  });
});
