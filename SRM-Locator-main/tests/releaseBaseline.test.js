import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase';

// Captured from the checksum-verified published js-1.1.63 bundle, rather than
// from main: release tags previously pointed at a different source baseline.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/release-1.1.63-places.json', import.meta.url), 'utf8'));

describe('published 1.1.63 campus data survives later UI updates', () => {
  it('retains every shipped place with its category and coordinates', () => {
    expect(baseline.places).toHaveLength(141);
    for (const place of baseline.places) {
      expect(SRM_MASTER_DATABASE.find((p) => p.name === place.name), place.name).toMatchObject(place);
    }
  });
});
