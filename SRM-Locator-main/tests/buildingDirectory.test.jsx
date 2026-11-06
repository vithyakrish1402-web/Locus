// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import BuildingDirectory from '../src/components/map/BuildingDirectory';
const places = [
  { id: 999, name: 'Library', category: 'ACADEMIC', lat: 12.824, lng: 80.045, aliases: ['Books'] },
  { id: 998, name: 'Hostel', category: 'RESIDENTIAL', lat: 12.827, lng: 80.046 },
];
afterEach(cleanup);
function setup(query = '') {
  const props = { places, query, onSearch: vi.fn(), me: { lat: 12.824, lng: 80.044 }, onOpen: vi.fn(), onArScan: vi.fn(), onNavigate: vi.fn() };
  const view = render(<BuildingDirectory {...props} />);
  return { ...view, props };
}
it('filters categories with accessible selection and shows a useful empty state', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /Hostels/ }));
  expect(screen.getByRole('button', { name: /Hostels/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getAllByTestId('building-row')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'View Hostel' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Medical/ }));
  expect(screen.getByText('No places in this category yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show all places' }));
  expect(screen.getAllByTestId('building-row')).toHaveLength(2);
});
it('supports aliases in search and keeps navigation separate from details', () => {
  const { props } = setup('Books');
  const row = screen.getByTestId('building-row');
  fireEvent.click(within(row).getByRole('button', { name: 'View Library' }));
  expect(props.onOpen).toHaveBeenCalledWith(places[0]);
  fireEvent.click(within(row).getByRole('button', { name: /Navigate to/ }));
  expect(props.onNavigate).toHaveBeenCalledWith(places[0]);
  expect(props.onOpen).toHaveBeenCalledTimes(1);
});
it('clears the category and query together from an empty search', () => {
  const { props } = setup('unknown');
  fireEvent.click(screen.getByRole('button', { name: 'Show all places' }));
  expect(props.onSearch).toHaveBeenCalledWith('');
});
