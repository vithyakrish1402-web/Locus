// @vitest-environment jsdom
//
// Phase 4 fixes in single components:
//  - the place card: with no known location (a lost teammate who never shared one), Navigate,
//    Rally and AR Scan are disabled and the card says why;
//  - the Buildings list: an empty category says when other categories match the search, and a
//    selected category whose last place has gone is All again.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import PlaceCard from '../src/components/PlaceCard.jsx';
import BuildingDirectory from '../src/components/map/BuildingDirectory.jsx';
import { PLACE } from '../src/copy/place.js';

MotionGlobalConfig.skipAnimations = true;
afterEach(cleanup);

const card = (place) => {
  const props = { place, onClose: vi.fn(), onNavigate: vi.fn(), onArScan: vi.fn(), rally: { active: false, onPress: vi.fn() } };
  render(<PlaceCard {...props} />);
  return props;
};

describe('PlaceCard with no location', () => {
  it('disables Navigate, Rally and AR Scan, and says why', () => {
    const props = card({ id: 'ghost-u-2', name: 'Bravo (last seen)', category: 'SQUAD', lat: undefined, lng: undefined });
    for (const id of ['place-navigate', 'place-rally', 'place-ar-scan']) {
      expect(screen.getByTestId(id).disabled).toBe(true);
      fireEvent.click(screen.getByTestId(id));
    }
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(props.onArScan).not.toHaveBeenCalled();
    expect(props.rally.onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('place-no-location').textContent).toBe(PLACE.noLocation);
  });

  it('with a location, all three work and there is no notice', () => {
    const props = card({ id: 1, name: 'Library', category: 'ACADEMIC', lat: 12.824, lng: 80.045 });
    fireEvent.click(screen.getByTestId('place-navigate'));
    expect(props.onNavigate).toHaveBeenCalled();
    expect(screen.queryByTestId('place-no-location')).toBeNull();
  });
});

describe('BuildingDirectory', () => {
  const library = { id: 999, name: 'Library', category: 'ACADEMIC', lat: 12.824, lng: 80.045 };
  const hostel = { id: 998, name: 'Hostel', category: 'RESIDENTIAL', lat: 12.827, lng: 80.046 };
  const field = { id: 997, name: 'Main Field', category: 'GROUNDS', lat: 12.825, lng: 80.047 };
  const props = (places, query = '') => ({ places, query, onSearch: vi.fn(), me: null, onOpen: vi.fn(), onArScan: vi.fn(), onNavigate: vi.fn() });

  it('an empty category says how many matches the other categories have', () => {
    render(<BuildingDirectory {...props([library, hostel], 'Library')} />);
    fireEvent.click(screen.getByRole('button', { name: /Hostels/ }));
    expect(screen.getByTestId('buildings-no-match').textContent).toBe('Nothing called "Library" in Hostels. 1 match in other categories.');
  });

  it('with no match anywhere, keeps the plain message', () => {
    render(<BuildingDirectory {...props([library, hostel], 'Zzz')} />);
    fireEvent.click(screen.getByRole('button', { name: /Hostels/ }));
    expect(screen.getByTestId('buildings-no-match').textContent).not.toMatch(/other categories/);
  });

  it('a selected category whose last place has gone is All again', () => {
    const view = render(<BuildingDirectory {...props([library, hostel, field])} />);
    fireEvent.click(screen.getByRole('button', { name: /Grounds/ }));
    expect(screen.getAllByTestId('building-row')).toHaveLength(1);
    view.rerender(<BuildingDirectory {...props([library, hostel])} />);
    expect(screen.queryByRole('button', { name: /Grounds/ })).toBeNull();
    expect(screen.getAllByTestId('building-row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /All places/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
