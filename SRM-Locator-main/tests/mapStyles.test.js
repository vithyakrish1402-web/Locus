// The map's light and dark looks (redesign Map batch, piece 4): the Google style picked by
// theme, and the Leaflet tiles' CSS following <html data-theme>.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { DARK_MAP_STYLES, LIGHT_MAP_STYLES, mapStylesFor } from '../src/utils/mapStyles.js';

const css = postcss.parse(readFileSync(new URL('../src/index.css', import.meta.url), 'utf8'));
const filterOf = (selector) => {
  let value = null;
  css.walkRules((rule) => { if (rule.selector === selector) rule.walkDecls('filter', (d) => { value = d.value; }); });
  return value;
};

describe('the Google style', () => {
  it('is picked by theme', () => {
    expect(mapStylesFor('light')).toBe(LIGHT_MAP_STYLES);
    expect(mapStylesFor('dark')).toBe(DARK_MAP_STYLES);
  });

  it("uses the handoff's map colours", () => {
    const land = (styles) => styles.find((s) => !s.featureType && s.elementType === 'geometry').stylers[0].color;
    expect(land(LIGHT_MAP_STYLES)).toBe('#EEF0EC');
    expect(land(DARK_MAP_STYLES)).toBe('#171B21');
  });

  it('keeps roads, water and place names (only business and transit pins turned down)', () => {
    for (const styles of [LIGHT_MAP_STYLES, DARK_MAP_STYLES]) {
      const hidden = styles.filter((s) => s.stylers.some((x) => x.visibility === 'off'));
      expect(hidden.map((s) => s.featureType)).toEqual(['poi.business', 'transit']);
    }
  });
});

describe('the Leaflet tiles', () => {
  it('are only calmed in the light theme', () => {
    expect(filterOf('.locus-map-tiles')).not.toMatch(/invert/);
  });

  it('are inverted into the dark map colours in the dark theme', () => {
    expect(filterOf(':root[data-theme="dark"] .locus-map-tiles')).toMatch(/invert\(1\)/);
  });
});
