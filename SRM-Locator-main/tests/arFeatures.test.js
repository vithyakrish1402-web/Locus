// AR Scan Stage 6: each feature's own override, weighed against the main dial in one place.
import { describe, it, expect } from 'vitest';
import {
  AR_FEATURE_OPTIONS,
  DEFAULT_AR_FEATURE_OVERRIDES,
  resolveArFeatures,
  resolveFeatureFidelity,
} from '../src/utils/arFeatures.js';

const DIALS = ['efficient', 'standard', 'realistic'];

describe('the options each feature offers', () => {
  it('tags: only off (there is no 3D tag)', () => {
    expect(AR_FEATURE_OPTIONS.tags).toEqual(['off']);
  });
  it('road line: off, efficient or realistic', () => {
    expect(AR_FEATURE_OPTIONS.roadLine).toEqual(['off', 'efficient', 'realistic']);
  });
  it('arrow: efficient or realistic, never off', () => {
    expect(AR_FEATURE_OPTIONS.arrow).toEqual(['efficient', 'realistic']);
  });
  it('all default to auto', () => {
    expect(DEFAULT_AR_FEATURE_OVERRIDES).toEqual({ tags: 'auto', roadLine: 'auto', arrow: 'auto' });
  });
});

describe('resolveFeatureFidelity', () => {
  it('follows the dial on auto', () => {
    for (const dial of DIALS) expect(resolveFeatureFidelity(dial, 'auto', ['off', 'realistic'])).toBe(dial);
  });

  it('takes an allowed override over any dial', () => {
    for (const dial of DIALS) {
      expect(resolveFeatureFidelity(dial, 'off', ['off', 'efficient', 'realistic'])).toBe('off');
      expect(resolveFeatureFidelity(dial, 'efficient', ['off', 'efficient', 'realistic'])).toBe('efficient');
      expect(resolveFeatureFidelity(dial, 'realistic', ['off', 'efficient', 'realistic'])).toBe('realistic');
    }
  });

  it('ignores an override the feature doesn’t offer, following the dial', () => {
    expect(resolveFeatureFidelity('realistic', 'off', AR_FEATURE_OPTIONS.arrow)).toBe('realistic');
    expect(resolveFeatureFidelity('standard', 'realistic', AR_FEATURE_OPTIONS.tags)).toBe('standard');
    expect(resolveFeatureFidelity('standard', undefined, AR_FEATURE_OPTIONS.roadLine)).toBe('standard');
  });
});

describe('resolveArFeatures', () => {
  it('with every override on auto (or none given), every feature follows the dial', () => {
    for (const dial of DIALS) {
      expect(resolveArFeatures(dial, DEFAULT_AR_FEATURE_OVERRIDES)).toEqual({ tags: dial, roadLine: dial, arrow: dial });
      expect(resolveArFeatures(dial)).toEqual({ tags: dial, roadLine: dial, arrow: dial });
      expect(resolveArFeatures(dial, {})).toEqual({ tags: dial, roadLine: dial, arrow: dial });
    }
  });

  it('overrides only the feature it is set on', () => {
    expect(resolveArFeatures('realistic', { tags: 'auto', roadLine: 'off', arrow: 'auto' }))
      .toEqual({ tags: 'realistic', roadLine: 'off', arrow: 'realistic' });
    expect(resolveArFeatures('efficient', { tags: 'off', roadLine: 'realistic', arrow: 'realistic' }))
      .toEqual({ tags: 'off', roadLine: 'realistic', arrow: 'realistic' });
    expect(resolveArFeatures('realistic', { tags: 'auto', roadLine: 'efficient', arrow: 'efficient' }))
      .toEqual({ tags: 'realistic', roadLine: 'efficient', arrow: 'efficient' });
  });

  it('never turns the arrow off, whatever it is given', () => {
    for (const dial of DIALS) expect(resolveArFeatures(dial, { arrow: 'off' }).arrow).toBe(dial);
  });
});
