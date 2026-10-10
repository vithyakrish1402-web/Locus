// @vitest-environment jsdom
//
// One building in the buildings list (redesign Map batch, piece 9).
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import BuildingRow from '../src/components/map/BuildingRow.jsx';
import { BUILDING_LIST } from '../src/copy/map.js';

afterEach(cleanup);

const TECH_PARK = { id: 2, name: 'TECH PARK', category: 'ACADEMIC', lat: 12.8246, lng: 80.0453, info: 'Home to CSE & IT departments.' };
const ME = { lat: 12.8234, lng: 80.0446 };

const renderRow = (props = {}) => {
  const handlers = { onOpen: vi.fn(), onArScan: vi.fn(), onNavigate: vi.fn() };
  render(<BuildingRow building={TECH_PARK} me={ME} {...handlers} {...props} />);
  return handlers;
};

describe('a building in the list', () => {
  it('shows its category, name, how far, and its line', () => {
    renderRow();
    expect(screen.getByText('Academic')).toBeTruthy();
    expect(screen.getByText('TECH PARK')).toBeTruthy();
    expect(screen.getByText(/^\d+ m away$/)).toBeTruthy();
    expect(screen.getByText(TECH_PARK.info)).toBeTruthy();
  });

  it('without a fix, no distance', () => {
    renderRow({ me: null });
    expect(screen.queryByText(/away/)).toBeNull();
  });

  it('AR Scan and Navigate do their own thing, not the row\'s', () => {
    const h = renderRow();
    fireEvent.click(screen.getByRole('button', { name: BUILDING_LIST.arScanFor('TECH PARK') }));
    fireEvent.click(screen.getByRole('button', { name: BUILDING_LIST.navigateTo('TECH PARK') }));
    expect(h.onArScan).toHaveBeenCalledTimes(1);
    expect(h.onNavigate).toHaveBeenCalledTimes(1);
    expect(h.onOpen).not.toHaveBeenCalled();
  });

  it('tapping the row shows the building', () => {
    const h = renderRow();
    fireEvent.click(screen.getByText('TECH PARK'));
    expect(h.onOpen).toHaveBeenCalledTimes(1);
  });

  it('never in the old tactical words or red', () => {
    renderRow();
    const row = screen.getByTestId('building-row');
    expect(row.textContent).not.toMatch(/SELECT_WAYPOINT|AWAY|\[2\]/);
    expect(row.outerHTML).not.toMatch(/red-|font-dot/);
  });
});
