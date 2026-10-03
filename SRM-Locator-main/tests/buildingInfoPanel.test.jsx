// @vitest-environment jsdom
//
// The Building Info panel for every building in the database, rendered on its own (the App
// wiring is in buildingInfoApp.test.jsx): never blank, never "undefined", both actions there.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import BuildingInfo from '../src/components/BuildingInfo.jsx';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase.js';
import { BUILDING_INFO_EMPTY_TEXT } from '../src/utils/buildingInfo.js';

afterEach(cleanup);

describe('BuildingInfo', () => {
  const me = { lat: 12.8234, lng: 80.0424 };

  it.each(SRM_MASTER_DATABASE.map((b) => [b.name, b]))('%s: has content and both actions', (_name, b) => {
    render(<BuildingInfo building={b} me={me} onTakeMeThere={() => {}} onShowOnMap={() => {}} />);
    const panel = screen.getByTestId('building-info');
    expect(panel.textContent.trim().length).toBeGreaterThan(0);
    expect(panel.textContent).not.toMatch(/undefined|null|NaN/);
    expect(within(panel).getByRole('button', { name: /take me there/i })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: /show on map/i })).toBeTruthy();
  });

  it('still reads well with no position of our own yet', () => {
    render(<BuildingInfo building={{ id: 99999, name: 'NEW BLOCK' }} me={null} onTakeMeThere={() => {}} onShowOnMap={() => {}} />);
    const panel = screen.getByTestId('building-info');
    expect(panel.textContent).toContain(`NEW BLOCK. ${BUILDING_INFO_EMPTY_TEXT}.`);
    expect(panel.textContent).not.toContain('From you');
  });

  it('shows the distance and direction from us when there is a fix', () => {
    render(<BuildingInfo building={{ id: 99999, name: 'NEW BLOCK', lat: me.lat + 0.001, lng: me.lng }} me={me} onTakeMeThere={() => {}} onShowOnMap={() => {}} />);
    expect(screen.getByTestId('building-info').textContent).toMatch(/From you.*\d+ M · BEARING N/);
  });
});
