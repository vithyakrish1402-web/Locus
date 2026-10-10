// @vitest-environment jsdom
//
// The route card (redesign Map batch, piece 6): your own route in words, and "End route",
// which only ends your route.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RouteCard from '../src/components/map/RouteCard.jsx';
import { ROUTE_CARD } from '../src/copy/map.js';

afterEach(cleanup);

const data = { distance: { text: '450 M' }, duration: { text: '6 MINS' } };

describe('the route card', () => {
  it('from where you are: "Walking to", minutes, metres and "from your location"', () => {
    render(<RouteCard start={{ name: 'MY_LOCATION' }} end={{ name: 'TECH PARK' }} data={data} onEnd={() => {}} />);
    expect(screen.getByText('Walking to TECH PARK')).toBeTruthy();
    expect(screen.getByText('6 min · 450 m · from your location')).toBeTruthy();
  });

  it('from one place to another (no fix): names the start', () => {
    render(<RouteCard start={{ name: 'MBA BLOCK' }} end={{ name: 'TECH PARK' }} data={{ distance: { text: '1.20 KM' }, duration: { text: '1 MIN' } }} onEnd={() => {}} />);
    expect(screen.getByText('1 min · 1.20 km · from MBA BLOCK')).toBeTruthy();
  });

  it('while the destination is still to choose, says so', () => {
    render(<RouteCard start={{ name: 'MBA BLOCK' }} end={null} data={null} onEnd={() => {}} />);
    expect(screen.getByText(ROUTE_CARD.choosing)).toBeTruthy();
    expect(screen.getByText(ROUTE_CARD.choosingHelp('MBA BLOCK'))).toBeTruthy();
  });

  it('"End route" is written on the button, and ends the route', () => {
    const onEnd = vi.fn();
    render(<RouteCard start={{ name: 'MY_LOCATION' }} end={{ name: 'TECH PARK' }} data={data} onEnd={onEnd} />);
    const button = screen.getByRole('button', { name: ROUTE_CARD.end });
    expect(button.textContent).toBe(ROUTE_CARD.end);
    fireEvent.click(button);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('never in the old tactical words or red', () => {
    render(<RouteCard start={{ name: 'MY_LOCATION' }} end={{ name: 'TECH PARK' }} data={data} onEnd={() => {}} />);
    const card = screen.getByTestId('route-card');
    expect(card.textContent).not.toMatch(/ACTIVE_WAYPOINT|MY_LOCATION|ETA|AWAITING/);
    expect(card.outerHTML).not.toMatch(/red-|danger/);
  });
});
