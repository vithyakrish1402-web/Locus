// @vitest-environment jsdom
//
// js-1.1.71 and js-1.1.72 (Dshn4Real), rebuilt in source from the published bundle: official tour
// photos for 43 places, and a category line, tags and description for 141. The place card shows
// them and no longer shows the unverified Open/Closed and floor-count chips.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { LOCATION_CONTENT, TOUR_PHOTOS } from '../src/data/campusLocationContent';
import { getBuildingAsset } from '../src/data/srmBuildingAssets';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase';
import PlaceCard from '../src/components/PlaceCard';

afterEach(cleanup);

const tech = SRM_MASTER_DATABASE.find((p) => p.id === 2);
const card = (place) => render(<PlaceCard place={place} onClose={() => {}} onNavigate={() => {}} onArScan={() => {}} rally={{ active: false, onPress: () => {} }} />);

describe('the place data', () => {
  it('has words for 141 places and official photos for 43, every photo a file the app ships', () => {
    expect(Object.keys(LOCATION_CONTENT)).toHaveLength(141);
    expect(Object.keys(TOUR_PHOTOS)).toHaveLength(43);
    for (const { image, photos } of Object.values(TOUR_PHOTOS)) {
      for (const p of [image, ...photos]) expect(fs.existsSync(path.join('public', p)), p).toBe(true);
    }
  });

  it("puts a place's tour photos first and its own words on its asset", () => {
    const asset = getBuildingAsset(tech);
    expect(asset.image).toBe(TOUR_PHOTOS[2].image);
    expect(asset.photos).toEqual(TOUR_PHOTOS[2].photos);
    expect(asset).toMatchObject({ categoryDisplay: LOCATION_CONTENT[2].categoryDisplay, tags: LOCATION_CONTENT[2].tags, description: LOCATION_CONTENT[2].description });
  });

  it("uses a place's description as its line in the list", () => {
    expect(tech.info).toBe(LOCATION_CONTENT[2].description);
    const noWords = SRM_MASTER_DATABASE.find((p) => !LOCATION_CONTENT[p.id]);
    if (noWords) expect(noWords.info).toBeTruthy();
  });
});

describe('the place card', () => {
  it('shows the category line, the tags and the description', () => {
    card(tech);
    expect(screen.getByText(LOCATION_CONTENT[2].categoryDisplay)).toBeTruthy();
    for (const tag of LOCATION_CONTENT[2].tags) expect(screen.getByText(tag)).toBeTruthy();
    expect(screen.getByTestId('place-description').textContent).toBe(LOCATION_CONTENT[2].description);
  });

  it('no longer shows Open/Closed or a floor count: nothing had checked them', () => {
    card(tech);
    expect(screen.queryByText('Open')).toBeNull();
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.queryByText(/Floors$/)).toBeNull();
  });
});
