// @vitest-environment jsdom
//
// "More about this place" for every building in the database, rendered on its own (the App
// wiring is in buildingInfoApp.test.jsx): never blank, never "undefined", and in plain words.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import BuildingInfo from '../src/components/BuildingInfo.jsx';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase.js';
import { PLACE } from '../src/copy/place.js';

afterEach(cleanup);

describe('BuildingInfo', () => {
  const me = { lat: 12.8234, lng: 80.0424 };

  it.each(SRM_MASTER_DATABASE.map((b) => [b.name, b]))('%s: has content', (_name, b) => {
    render(<BuildingInfo building={b} me={me} />);
    const panel = screen.getByTestId('building-info');
    expect(panel.textContent.trim().length).toBeGreaterThan(PLACE.more.length);
    expect(panel.textContent).not.toMatch(/undefined|null|NaN|BEARING|O'CLOCK/);
  });

  it('still reads well with no position of our own yet', () => {
    render(<BuildingInfo building={{ id: 99999, name: 'NEW BLOCK' }} me={null} />);
    const panel = screen.getByTestId('building-info');
    expect(panel.textContent).toContain(PLACE.noDetails);
    expect(panel.textContent).not.toContain(PLACE.fromYou);
  });

  it('shows the distance and direction from us, in words, when there is a fix', () => {
    render(<BuildingInfo building={{ id: 99999, name: 'NEW BLOCK', lat: me.lat + 0.001, lng: me.lng }} me={me} />);
    expect(screen.getByTestId('building-info').textContent).toMatch(new RegExp(`${PLACE.fromYou}\\d+ m · to the north`));
  });

  it("uses the clock face while the compass is live", () => {
    render(<BuildingInfo building={{ id: 99999, name: 'NEW BLOCK', lat: me.lat + 0.001, lng: me.lng }} me={me} heading={330} headingLive />);
    expect(screen.getByTestId('building-info').textContent).toMatch(/\d+ m · 1 o’clock/);
  });
});
