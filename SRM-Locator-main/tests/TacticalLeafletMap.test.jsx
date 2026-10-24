// @vitest-environment jsdom
//
// The Leaflet engine's Rally Point marker, rendered for real (react-leaflet in jsdom):
// the ✕ that clears it follows `canClearWaypoint`, decided in App.jsx by the same rule the
// server applies (the Commander, or the member who dropped it). It used to decide for
// itself from `squadRole`, which offered the ✕ to the Commander alone.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import TacticalLeafletMap from '../src/components/TacticalLeafletMap.jsx';

afterEach(cleanup);

const renderMap = (props) =>
  render(
    <div style={{ width: 400, height: 400 }}>
      <TacticalLeafletMap
        center={{ lat: 12.8231, lng: 80.0442 }}
        zoom={17}
        onZoomChange={() => {}}
        onMapClick={() => {}}
        onFocus={() => {}}
        liveLocation={null}
        liveIsNavigating={false}
        liveHeading={0}
        currentZoom={17}
        users={[]}
        blockedUserIds={[]}
        ghostMembers={[]}
        activeTab="users"
        activeWaypoint={{ lat: 12.8231, lng: 80.0442, name: 'RALLY POINT', setBy: 'u-self' }}
        walkingRoute={null}
        onArTrack={() => {}}
        isSatellite={false}
        highlightBuildingId={null}
        {...props}
      />
    </div>
  );

describe('the Rally Point marker on the Leaflet engine', () => {
  it('offers the clear control when App.jsx says this user may clear it', async () => {
    const onClearWaypoint = vi.fn();
    renderMap({ canClearWaypoint: true, onClearWaypoint });
    fireEvent.click(await screen.findByTitle('Remove meeting point'));
    expect(onClearWaypoint).toHaveBeenCalledTimes(1);
  });

  it('withholds it otherwise', async () => {
    renderMap({ canClearWaypoint: false, onClearWaypoint: () => {} });
    await screen.findByTitle('Find with AR Scan');
    expect(screen.queryByTitle('Remove meeting point')).toBeNull();
  });
});

// The walking line in the theme's route colour (redesign Map batch, piece 5), never red.
describe('the walking line on the Leaflet engine', () => {
  const route = { path: [{ lat: 12.8231, lng: 80.0442 }, { lat: 12.8240, lng: 80.0450 }], isRealRoute: true };

  it("is drawn in the route colour it is given (App.jsx reads the theme's)", () => {
    const { container } = renderMap({ walkingRoute: route, routeColor: '#123456' });
    expect(container.querySelector('path[stroke="#123456"]')).toBeTruthy();
  });

  it('a real route: solid, 5 px, on a 9 px casing in the casing colour', () => {
    const { container } = renderMap({ walkingRoute: route, routeColor: '#123456', casingColor: '#ABCDEF' });
    const line = container.querySelector('path[stroke="#123456"]');
    const casing = container.querySelector('path[stroke="#ABCDEF"]');
    expect(line.getAttribute('stroke-width')).toBe('5');
    expect(line.getAttribute('stroke-dasharray')).toBeNull();
    expect(casing.getAttribute('stroke-width')).toBe('9');
    // The casing is drawn first, so the line sits on it.
    expect(casing.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the best-effort straight line stays a sparse dash, with no casing', () => {
    const { container } = renderMap({ walkingRoute: { ...route, isRealRoute: false }, routeColor: '#123456', casingColor: '#ABCDEF' });
    expect(container.querySelector('path[stroke="#123456"]').getAttribute('stroke-dasharray')).toBe('2 12');
    expect(container.querySelector('path[stroke="#ABCDEF"]')).toBeNull();
  });

  it('defaults to the light accent, not red', () => {
    const { container } = renderMap({ walkingRoute: route });
    expect(container.querySelector('path[stroke="#1F4FB8"]')).toBeTruthy();
    expect(container.querySelector('path[stroke="#EF4444"]')).toBeNull();
  });
});

// Item 6 of the 2026-10 bug batch: the member being looked for is ringed on this engine too,
// remote members and lost-connection ones alike.
describe('the member being looked for, on the Leaflet engine', () => {
  const member = { id: 'sock-B', name: 'Bravo', lat: 12.8232, lng: 80.0443, hasFix: true, status: 'ACTIVE', speed: 0, heading: 0 };
  const other = { ...member, id: 'sock-C', name: 'Charlie', lng: 80.0446 };

  it('is highlighted, and nobody else is', async () => {
    renderMap({ activeWaypoint: null, users: [member, other], focusedMemberId: 'sock-B' });
    const markers = await screen.findAllByTestId('member-marker');
    const lit = markers.filter((m) => m.getAttribute('data-highlighted') === 'true');
    expect(lit).toHaveLength(1);
    expect(lit[0].textContent).toContain('Bravo');
  });

  it('is highlighted when their connection was lost, too', async () => {
    const ghost = { id: 'sock-G', name: 'Golf', position: { lat: 12.8233, lng: 80.0444 }, lastKnownLocation: { lat: 12.8233, lng: 80.0444 }, phase: 'expired', elapsedLabel: '5:00' };
    renderMap({ activeWaypoint: null, ghostMembers: [ghost], focusedMemberId: 'sock-G' });
    expect((await screen.findByTestId('ghost-marker')).getAttribute('data-highlighted')).toBe('true');
  });

  it('is nobody without a focus', async () => {
    renderMap({ activeWaypoint: null, users: [member] });
    expect((await screen.findByTestId('member-marker')).getAttribute('data-highlighted')).toBeNull();
  });
});

// Item 10 of the 2026-10 bug batch: nothing guesses where a member went.
describe('a lost or quiet member on the Leaflet engine', () => {
  it('has no projection line to a guessed position, just the marker at their last known location', async () => {
    const ghost = { id: 'sock-G', name: 'Golf', position: { lat: 12.8233, lng: 80.0444 }, lastKnownLocation: { lat: 12.8233, lng: 80.0444 }, phase: 'lost', elapsedLabel: '0:30', speedKmh: 18, heading: 90 };
    const { container } = renderMap({ activeWaypoint: null, ghostMembers: [ghost] });
    await screen.findByTestId('ghost-marker');
    expect(container.querySelectorAll('path.leaflet-interactive')).toHaveLength(0);
  });

  it('is dimmed with "last update N min ago" once their position is stale, and stays where it was', async () => {
    const quiet = { id: 'sock-Q', name: 'Quebec', lat: 12.8232, lng: 80.0443, hasFix: true, status: 'ACTIVE', speed: 0, heading: 0, lastSeen: Date.now() - 3 * 60000 };
    renderMap({ activeWaypoint: null, users: [quiet] });
    const marker = await screen.findByTestId('member-marker');
    expect(marker.getAttribute('data-stale')).toBe('true');
    expect(marker.textContent).toContain('Quebec · last update 3 min ago');
  });

  it('is not dimmed while their position is fresh', async () => {
    const live = { id: 'sock-L', name: 'Lima', lat: 12.8232, lng: 80.0443, hasFix: true, status: 'ACTIVE', speed: 0, heading: 0, lastSeen: Date.now() - 5000 };
    renderMap({ activeWaypoint: null, users: [live] });
    expect((await screen.findByTestId('member-marker')).getAttribute('data-stale')).toBeNull();
  });
});
