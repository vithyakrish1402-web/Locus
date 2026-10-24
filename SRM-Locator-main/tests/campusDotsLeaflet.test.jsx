// @vitest-environment jsdom
//
// The campus dots on the free (Leaflet) map: App.jsx says whether they show (showBuildings: on
// a phone always, on a larger screen for the Buildings tab); without it, the old rule holds.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
        places={[{ id: 'a', name: 'A', lat: 12.8231, lng: 80.0442 }, { id: 'b', name: 'B', lat: 12.8235, lng: 80.0446 }]}
        activeWaypoint={null}
        walkingRoute={null}
        onArTrack={() => {}}
        isSatellite={false}
        highlightBuildingId={null}
        {...props}
      />
    </div>
  );

const dots = () => screen.queryAllByTestId('building-marker').length;

describe('the campus dots on the Leaflet map', () => {
  it('show for showBuildings, whatever the tab', async () => {
    renderMap({ activeTab: 'users', showBuildings: true });
    await screen.findAllByTestId('building-marker');
    expect(dots()).toBe(2);
  });

  it('are hidden when showBuildings is false', async () => {
    const { container } = renderMap({ activeTab: 'buildings', showBuildings: false });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('.leaflet-container')).toBeTruthy();
    expect(dots()).toBe(0);
  });

  it('follow the Buildings tab when App.jsx does not say', async () => {
    renderMap({ activeTab: 'buildings' });
    await screen.findAllByTestId('building-marker');
    expect(dots()).toBe(2);
    cleanup();
    const { container } = renderMap({ activeTab: 'users' });
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('.leaflet-container')).toBeTruthy();
    expect(dots()).toBe(0);
  });
});
