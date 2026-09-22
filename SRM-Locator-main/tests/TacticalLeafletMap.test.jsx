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
    fireEvent.click(await screen.findByTitle('Clear Rally Point'));
    expect(onClearWaypoint).toHaveBeenCalledTimes(1);
  });

  it('withholds it otherwise', async () => {
    renderMap({ canClearWaypoint: false, onClearWaypoint: () => {} });
    await screen.findByTitle('AR Track Rally Point');
    expect(screen.queryByTitle('Clear Rally Point')).toBeNull();
  });
});
