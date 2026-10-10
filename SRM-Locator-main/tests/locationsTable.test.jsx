// @vitest-environment jsdom
//
// The Group Lead's locations table in the new look (Stop 2 leftovers). Its words are unchanged
// until the wording pass; these tests pin its look: a labelled dialog on the theme's surface, no
// red and no glow, amber for problems, a Close button, and room above the Emergency button.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import LocationsTable from '../src/components/group/LocationsTable.jsx';

MotionGlobalConfig.skipAnimations = true;
afterEach(cleanup);

const members = [{ id: 'a', name: 'Aarav Shah' }, { id: 'b', name: 'Rohan Das' }];
const rows = {
  a: { latitude: 12.82351, longitude: 80.04462, battery: { text: '77%', color: 'text-success' }, freshness: { text: 'OPTIMAL (< 10s)', color: 'text-success' } },
  b: { latitude: null, longitude: null, battery: { text: '15%', color: 'text-warning' }, freshness: { text: 'STALE (> 5m)', color: 'text-warning' } },
};
const show = (props = {}) => render(
  <LocationsTable open members={members} rowFor={(m) => rows[m.id]} sync={{ status: 'idle', message: null }} onRefresh={vi.fn()} onClose={vi.fn()} {...props} />,
);

describe('the locations table', () => {
  it('is a dialog named by its title, on the theme surface, with no red, no glow and no old tactical look', () => {
    show();
    const dialog = screen.getByRole('dialog', { name: 'SYS_TELEMETRY // MATRIX' });
    expect(dialog.className).toContain('bg-surface');
    const html = screen.getByTestId('locations-table').outerHTML;
    expect(html).not.toMatch(/danger|red-|bg-emergency|text-emergency|yellow-|zinc-|emerald-|bg-black|font-dot|shadow-\[0_0|animate-pulse|bg-dots/);
  });

  it('shows each member: position, battery and signal, with No position when there is none', () => {
    show();
    const [aarav, rohan] = screen.getAllByTestId('locations-row');
    expect(within(aarav).getByText('Aarav Shah')).toBeTruthy();
    expect(aarav.textContent).toContain('LAT: 12.82351');
    expect(rohan.textContent).toContain('NO_CACHE_DATA');
    expect(rohan.children[2].className).toContain('text-warning');
    expect(rohan.children[3].className).toContain('text-warning');
  });

  it('Close and a tap outside close it; FORCE_SYNC refreshes, and says so while it waits', () => {
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    const { rerender } = show({ onClose, onRefresh });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByTestId('locations-table'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('locations-table-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    rerender(<LocationsTable open members={members} rowFor={(m) => rows[m.id]} sync={{ status: 'pending', message: null }} onRefresh={onRefresh} onClose={onClose} />);
    expect(screen.getByTestId('locations-table-refresh').disabled).toBe(true);
    expect(screen.getByTestId('locations-table-refresh').textContent).toContain('SYNCING...');
  });

  it("a failed refresh says why in amber", () => {
    show({ sync: { status: 'error', message: 'No answer from the server.' } });
    expect(screen.getByText('No answer from the server.').className).toContain('text-warning');
  });

  it('with nobody else yet, says so', () => {
    show({ members: [] });
    expect(screen.getByText('NO OTHER OPERATIVES IN THE SQUAD YET.')).toBeTruthy();
  });

  it('ends above the Emergency button, and stands under it', () => {
    show();
    const backdrop = screen.getByTestId('locations-table');
    expect(backdrop.style.paddingBottom).toBe('var(--emergency-clearance)');
    expect(backdrop.className).toContain('z-[4000]');
  });
});
