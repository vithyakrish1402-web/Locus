// AR Scan's per-feature overrides (SYS_CONFIG's AR_FEATURE_OVERRIDES): each feature can
// follow the main AR_RENDER_MODE dial ('auto') or be set on its own. Pure, and the only
// place an override is weighed against the dial.

// What each feature can be set to, besides 'auto'. Not symmetric:
//   tags: there has never been a 3D version, so only whether they show.
//   roadLine: a light SVG version, a 3D one, or none (an older phone that can draw the
//     arrow but not the road as well).
//   arrow: no 'off'. AR Scan with no direction at all isn't a lighter mode, it's broken.
export const AR_FEATURE_OPTIONS = {
  tags: ['off'],
  roadLine: ['off', 'efficient', 'realistic'],
  arrow: ['efficient', 'realistic'],
};

export const DEFAULT_AR_FEATURE_OVERRIDES = { tags: 'auto', roadLine: 'auto', arrow: 'auto' };

/**
 * What one feature renders at: `override` when it is one of the feature's `allowed`
 * options, otherwise (for 'auto', or anything unexpected) the main dial's value. So a
 * stray value like an 'off' arrow falls back to the dial rather than hiding it.
 */
export const resolveFeatureFidelity = (mainFidelity, override, allowed) =>
  (override !== 'auto' && allowed.includes(override) ? override : mainFidelity);

/**
 * Every feature's resolved fidelity: { tags, roadLine, arrow }, each the dial's value
 * ('efficient' | 'standard' | 'realistic') or the feature's override, which may be 'off'
 * for tags and the road line. Consumers only ever ask "is it 'realistic'?" and "is it
 * 'off'?"; 'efficient' and 'standard' draw the same today.
 */
export const resolveArFeatures = (mainFidelity, overrides = DEFAULT_AR_FEATURE_OVERRIDES) =>
  Object.fromEntries(
    Object.entries(AR_FEATURE_OPTIONS).map(([feature, allowed]) => [
      feature,
      resolveFeatureFidelity(mainFidelity, overrides?.[feature] ?? 'auto', allowed),
    ]),
  );
